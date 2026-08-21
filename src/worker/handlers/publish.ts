/**
 * Stage 6: Publish newsletter to mymcpshelf.com (D1) and Beehiiv as a draft
 * Consumes messages from publish-queue
 *
 * Takes the assembled newsletter markdown, converts it to HTML, writes it as
 * a row in mymcpshelf's D1 `external_posts` table (cross-bound, no git/GitHub
 * involved), and creates a Beehiiv draft. A failure in one destination does
 * not block the other.
 *
 * Ghost is retired (brainscriblr.world lapsed) — the site target is now
 * mymcpshelf's D1 `external_posts`, which the site reads at request time and
 * surfaces under /blog?track=ai-field-notes and /rss/ai-field-notes.xml.
 */

import { Env } from '../index.js';
import { Logger, PipelineMetrics } from '../lib/logger.js';

interface PublishMessage {
  type: 'publish';
  generateId: string;
  newsletter: string;
  dates: string[]; // YYYY-MM-DD, newest first
  timestamp: number;
}

interface ParsedNewsletter {
  title: string;
  preheader: string;
  topHeadline: string;  // first story section heading, used in header image
  bodyMarkdown: string;
  html: string;
}

/**
 * Minimal markdown-to-HTML conversion for the site and Beehiiv body content.
 */
function markdownToHtml(md: string): string {
  // First pass: convert headers
  let html = md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Handle horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Handle bullet lists - group consecutive list items
  html = html.replace(/(^- .+\n?)+/gm, (match) => {
    const items = match.trim().split('\n').map(item =>
      `<li>${item.replace(/^- /, '')}</li>`
    ).join('\n');
    return `<ul>\n${items}\n</ul>`;
  });

  // Convert inline formatting (must use non-greedy)
  html = html
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Handle paragraphs - process line by line and group properly
  const lines = html.split('\n');
  const result: string[] = [];
  let inParagraph = false;
  let paragraphContent: string[] = [];

  for (const line of lines) {
    const isBlockStart = line.match(/^<(h[1-3]|ul|hr)/);
    const isBlockEnd = line.match(/<\/(h[1-3]|ul)>$/);
    const isEmpty = line.trim() === '';

    if (isBlockStart || isBlockEnd) {
      if (inParagraph) {
        result.push('<p>' + paragraphContent.join('<br>') + '</p>');
        paragraphContent = [];
        inParagraph = false;
      }
      result.push(line);
    } else if (isEmpty) {
      if (inParagraph && paragraphContent.length > 0) {
        result.push('<p>' + paragraphContent.join('<br>') + '</p>');
        paragraphContent = [];
        inParagraph = false;
      }
    } else {
      paragraphContent.push(line);
      inParagraph = true;
    }
  }

  if (inParagraph && paragraphContent.length > 0) {
    result.push('<p>' + paragraphContent.join('<br>') + '</p>');
  }

  return result.join('\n');
}

/**
 * Parse newsletter markdown into title, preheader, and body HTML.
 * Shared by both the site and Beehiiv publish functions.
 */
function parseNewsletter(message: PublishMessage): ParsedNewsletter {
  const lines = message.newsletter.split('\n');
  const title = lines[0].replace(/^#\s+/, '').trim() || `AI Newsletter — ${message.dates[0]}`;

  const preheaderIndex = lines.findIndex((l, i) => i > 0 && l.trim().startsWith('PLUS:'));
  const preheader = preheaderIndex >= 0 ? lines[preheaderIndex].trim() : '';

  const bodyLines = lines.filter((line, index) => {
    if (index === 0 && line.startsWith('# ')) return false;
    if (index === preheaderIndex) return false;
    return true;
  });

  const bodyMarkdown = bodyLines.join('\n');
  const html = markdownToHtml(bodyMarkdown.trim());

  // Extract first ## heading as the top headline tease for the header image
  const topHeadlineLine = bodyLines.find(l => l.startsWith('## '));
  const topHeadline = topHeadlineLine
    ? topHeadlineLine.replace(/^##\s+/, '').trim()
    : title;

  return { title, preheader, topHeadline, bodyMarkdown, html };
}

/**
 * Look up a header image via Pexels search (topHeadline as the query).
 * No attribution required for use, unlike Unsplash. Returns null on any
 * failure or missing key — image is optional, never blocks publish.
 */
async function fetchHeaderImage(query: string, apiKey: string | undefined): Promise<string | null> {
  if (!apiKey) return null;
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
    const response = await fetch(url, { headers: { Authorization: apiKey } });
    if (!response.ok) return null;
    const data = (await response.json()) as { photos: Array<{ src: { large: string } }> };
    return data.photos[0]?.src.large ?? null;
  } catch {
    return null;
  }
}

/** Astro reserves the filename/row key as the slug; keep it URL-safe and stable. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Publish to mymcpshelf.com by writing directly into its D1 `external_posts`
 * table (cross-bound — see MYMCPSHELF_DB in wrangler.toml). No git or GitHub
 * API involved; the site reads this table at request time.
 * Returns true on success, false on failure (failure is logged to KV).
 */
async function publishToMymcpshelf(
  message: PublishMessage,
  parsed: ParsedNewsletter,
  env: Env
): Promise<boolean> {
  const log = new Logger('stage-6:mymcpshelf').withContext(message.generateId);
  const { title, preheader, topHeadline, bodyMarkdown } = parsed;

  const dedupKey = `published:mymcpshelf:${message.generateId}`;
  const already = await env.INGEST_STATE.get(dedupKey);
  if (already) {
    log.info('already published — skipping');
    return true;
  }

  const slug = slugify(title);
  const image = await fetchHeaderImage(topHeadline, env.PEXELS_API_KEY);

  try {
    log.debug('inserting into mymcpshelf D1', { slug, body_chars: bodyMarkdown.length, has_image: !!image });

    await env.MYMCPSHELF_DB.prepare(
      `INSERT INTO external_posts (slug, track, title, description, body_markdown, author, image, published_at)
       VALUES (?, 'ai-field-notes', ?, ?, ?, 'Chester Beard', ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         body_markdown = excluded.body_markdown,
         image = excluded.image,
         published_at = excluded.published_at`
    ).bind(slug, title, preheader || topHeadline, bodyMarkdown, image, new Date().toISOString()).run();

    log.info('mymcpshelf post published', { slug });

    await env.INGEST_STATE.put(dedupKey, JSON.stringify({
      slug,
      title,
      timestamp: Date.now(),
    }), { expirationTtl: 60 * 60 * 24 * 30 });

    return true;
  } catch (error) {
    log.error('mymcpshelf publish failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    await env.INGEST_STATE.put(
      `error:mymcpshelf:${message.generateId}`,
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      }),
      { expirationTtl: 60 * 60 * 24 * 7 }
    );
    return false;
  }
}

/**
 * Publish to Beehiiv as a draft.
 * Returns true on success, false on failure (failure is logged to KV).
 * Skipped with a warning if BEEHIIV_API_KEY or BEEHIIV_PUBLICATION_ID is absent.
 */
async function publishToBeehiiv(
  message: PublishMessage,
  parsed: ParsedNewsletter,
  env: Env,
  featureImageUrl: string | null = null
): Promise<boolean> {
  const log = new Logger('stage-6:beehiiv').withContext(message.generateId);

  if (!env.BEEHIIV_API_KEY || !env.BEEHIIV_PUBLICATION_ID) {
    log.warn('beehiiv credentials not set — skipping');
    return true;
  }

  const { title, preheader, html } = parsed;

  const dedupKey = `published:beehiiv:${message.generateId}`;
  const already = await env.INGEST_STATE.get(dedupKey);
  if (already) {
    log.info('already published — skipping');
    return true;
  }

  try {
    log.debug('posting to beehiiv', { body_chars: html.length });

    const url = `https://api.beehiiv.com/v2/publications/${env.BEEHIIV_PUBLICATION_ID}/posts`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.BEEHIIV_API_KEY}`,
      },
      body: JSON.stringify({
        title,
        subtitle: preheader || undefined,
        status: 'draft',
        free_web_content: html,
        free_email_content: html,
        displayed_date: Math.floor(Date.now() / 1000),
        ...(featureImageUrl ? { thumbnail_url: featureImageUrl } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Beehiiv API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as { data: { id: string; web_url?: string } };
    const post = data.data;

    log.info('beehiiv draft created', { post_id: post.id, web_url: post.web_url ?? null });

    await env.INGEST_STATE.put(dedupKey, JSON.stringify({
      postId: post.id,
      webUrl: post.web_url ?? null,
      title,
      timestamp: Date.now(),
    }), { expirationTtl: 60 * 60 * 24 * 30 });

    return true;
  } catch (error) {
    log.error('beehiiv publish failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    await env.INGEST_STATE.put(
      `error:beehiiv:${message.generateId}`,
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      }),
      { expirationTtl: 60 * 60 * 24 * 7 }
    );
    return false;
  }
}

export async function handlePublishQueue(
  batch: MessageBatch<PublishMessage>,
  env: Env
): Promise<void> {
  const log = new Logger('stage-6');
  log.info('publish batch received', { messages: batch.messages.length });

  for (const msg of batch.messages) {
    const message = msg.body;
    const pubLog = log.withContext(message.generateId);
    const metrics = new PipelineMetrics(env.INGEST_STATE, message.generateId, 'metrics:generate');

    pubLog.info('publishing newsletter', { generate_id: message.generateId });

    const parsed = parseNewsletter(message);

    // Pexels header image (if key present) — shared by the site post and the Beehiiv draft.
    let featureImageUrl: string | null = null;
    try {
      featureImageUrl = await fetchHeaderImage(parsed.topHeadline, env.PEXELS_API_KEY);
    } catch (imgError) {
      pubLog.warn('header image failed — continuing without it', {
        error: imgError instanceof Error ? imgError.message : String(imgError),
      });
    }

    const [mymcpshelfOk, beehiivOk] = await Promise.all([
      publishToMymcpshelf(message, parsed, env),
      publishToBeehiiv(message, parsed, env, featureImageUrl),
    ]);

    await metrics.set('published_at', Date.now());
    if (mymcpshelfOk) await metrics.set('mymcpshelf_ok', true);
    if (beehiivOk) await metrics.set('beehiiv_ok', true);

    // mymcpshelf is required — always retry if it failed, regardless of Beehiiv
    if (!mymcpshelfOk) {
      pubLog.error('mymcpshelf publish failed — will retry', { generate_id: message.generateId });
      throw new Error(`mymcpshelf publish failed for ${message.generateId} — retrying`);
    }

    if (!beehiivOk) {
      pubLog.warn('beehiiv failed — mymcpshelf succeeded, continuing', { generate_id: message.generateId });
    }

    pubLog.info('publish complete', {
      generate_id: message.generateId,
      mymcpshelf: mymcpshelfOk,
      beehiiv: beehiivOk,
    });
  }
}
