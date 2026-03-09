/**
 * Stage 6: Publish newsletter to Ghost CMS and Beehiiv as drafts
 * Consumes messages from publish-queue
 *
 * Takes the assembled newsletter markdown, converts it to HTML,
 * and creates drafts in both Ghost and Beehiiv for review before sending.
 * A failure in one destination does not block the other.
 */

import { Env } from '../index.js';

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
  bodyMarkdown: string;
  html: string;
}

/**
 * Minimal markdown-to-HTML conversion for Ghost and Beehiiv body content.
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
 * Shared by both Ghost and Beehiiv publish functions.
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

  return { title, preheader, bodyMarkdown, html };
}

/**
 * Create a Ghost Admin API JWT token.
 * Ghost Admin API keys are in "id:secret" format where secret is hex-encoded.
 */
async function createGhostJwt(adminKey: string): Promise<string> {
  const [id, secret] = adminKey.split(':');
  if (!id || !secret) {
    throw new Error('Invalid Ghost Admin API key format — expected id:secret');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', kid: id, typ: 'JWT' };
  const payload = { iat: now, exp: now + 300, aud: '/admin/' };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const secretBytes = new Uint8Array(
    secret.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))
  );

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signingInput}.${sigB64}`;
}

/**
 * Publish to Ghost CMS as a draft.
 * Returns true on success, false on failure (failure is logged to KV).
 */
async function publishToGhost(
  message: PublishMessage,
  parsed: ParsedNewsletter,
  env: Env
): Promise<boolean> {
  const { title, preheader, html } = parsed;

  // Dedup check — also accept legacy key (published:{id}) for previously published newsletters
  const dedupKey = `published:ghost:${message.generateId}`;
  const legacyKey = `published:${message.generateId}`;
  const [already, alreadyLegacy] = await Promise.all([
    env.INGEST_STATE.get(dedupKey),
    env.INGEST_STATE.get(legacyKey),
  ]);
  if (already || alreadyLegacy) {
    console.log(`[Stage 6] Ghost: already published ${message.generateId} — skipping`);
    return true;
  }

  try {
    const mobiledoc = JSON.stringify({
      version: '0.3.1',
      atoms: [],
      cards: [['html', { html }]],
      markups: [],
      sections: [[10, 0]],
    });

    console.log(`[Stage 6] Ghost: body ${html.length} chars`);

    const jwt = await createGhostJwt(env.GHOST_ADMIN_API_KEY);
    const url = `${env.GHOST_API_URL}/ghost/api/admin/posts/`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Ghost ${jwt}`,
        'Accept-Version': 'v5.0',
      },
      body: JSON.stringify({
        posts: [
          {
            title,
            mobiledoc,
            status: 'draft',
            custom_excerpt: preheader || null,
            tags: [{ name: 'Newsletter' }, { name: 'AI' }],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ghost API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as { posts: Array<{ id: string; url: string }> };
    const post = data.posts[0];

    console.log(`[Stage 6] Ghost: ✓ draft created — ID: ${post.id}`);
    console.log(`[Stage 6] Ghost: ✓ URL: ${post.url}`);

    await env.INGEST_STATE.put(dedupKey, JSON.stringify({
      postId: post.id,
      postUrl: post.url,
      title,
      timestamp: Date.now(),
    }), { expirationTtl: 60 * 60 * 24 * 30 });

    return true;
  } catch (error) {
    console.error(`[Stage 6] Ghost publish failed for ${message.generateId}:`, error);
    await env.INGEST_STATE.put(
      `error:ghost:${message.generateId}`,
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
  env: Env
): Promise<boolean> {
  if (!env.BEEHIIV_API_KEY || !env.BEEHIIV_PUBLICATION_ID) {
    console.warn('[Stage 6] Beehiiv: BEEHIIV_API_KEY or BEEHIIV_PUBLICATION_ID not set — skipping');
    return true; // Not a failure — Beehiiv is optional
  }

  const { title, preheader, html } = parsed;

  const dedupKey = `published:beehiiv:${message.generateId}`;
  const already = await env.INGEST_STATE.get(dedupKey);
  if (already) {
    console.log(`[Stage 6] Beehiiv: already published ${message.generateId} — skipping`);
    return true;
  }

  try {
    console.log(`[Stage 6] Beehiiv: body ${html.length} chars`);

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
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Beehiiv API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as { data: { id: string; web_url?: string } };
    const post = data.data;

    console.log(`[Stage 6] Beehiiv: ✓ draft created — ID: ${post.id}`);

    await env.INGEST_STATE.put(dedupKey, JSON.stringify({
      postId: post.id,
      webUrl: post.web_url ?? null,
      title,
      timestamp: Date.now(),
    }), { expirationTtl: 60 * 60 * 24 * 30 });

    return true;
  } catch (error) {
    console.error(`[Stage 6] Beehiiv publish failed for ${message.generateId}:`, error);
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
  console.log(`[Stage 6] Processing publish batch with ${batch.messages.length} message(s)`);

  for (const msg of batch.messages) {
    const message = msg.body;
    console.log(`[Stage 6] Publishing for generate ID: ${message.generateId}`);

    const parsed = parseNewsletter(message);

    const [ghostOk, beehiivOk] = await Promise.all([
      publishToGhost(message, parsed, env),
      publishToBeehiiv(message, parsed, env),
    ]);

    if (!ghostOk && !beehiivOk) {
      throw new Error(`Both Ghost and Beehiiv publish failed for ${message.generateId} — retrying`);
    }

    if (!ghostOk) {
      console.error(`[Stage 6] Ghost failed for ${message.generateId} — Beehiiv succeeded, no retry`);
    }
    if (!beehiivOk) {
      console.error(`[Stage 6] Beehiiv failed for ${message.generateId} — Ghost succeeded, no retry`);
    }
  }
}
