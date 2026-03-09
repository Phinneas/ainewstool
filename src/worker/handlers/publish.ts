/**
 * Stage 6: Publish newsletter to Ghost CMS as a draft
 * Consumes messages from publish-queue
 *
 * Takes the assembled newsletter markdown, converts it to HTML,
 * and creates a Ghost post as a draft for review before sending.
 */

import { Env } from '../index.js';

interface PublishMessage {
  type: 'publish';
  generateId: string;
  newsletter: string;
  dates: string[]; // YYYY-MM-DD, newest first
  timestamp: number;
}

/**
 * Minimal markdown-to-HTML conversion for Ghost.
 * Ghost accepts HTML in the `html` field of the Admin API.
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
    // Check if this is a block element (starts a new block)
    const isBlockStart = line.match(/^<(h[1-3]|ul|hr)/);
    const isBlockEnd = line.match(/<\/(h[1-3]|ul)>$/);
    const isEmpty = line.trim() === '';

    if (isBlockStart || isBlockEnd) {
      // Close any open paragraph first
      if (inParagraph) {
        result.push('<p>' + paragraphContent.join('<br>') + '</p>');
        paragraphContent = [];
        inParagraph = false;
      }
      result.push(line);
    } else if (isEmpty) {
      // Empty line - close paragraph if open
      if (inParagraph && paragraphContent.length > 0) {
        result.push('<p>' + paragraphContent.join('<br>') + '</p>');
        paragraphContent = [];
        inParagraph = false;
      }
    } else {
      // Regular content - add to paragraph
      paragraphContent.push(line);
      inParagraph = true;
    }
  }

  // Close any remaining paragraph
  if (inParagraph && paragraphContent.length > 0) {
    result.push('<p>' + paragraphContent.join('<br>') + '</p>');
  }

  return result.join('\n');
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

export async function handlePublishQueue(
  batch: MessageBatch<PublishMessage>,
  env: Env
): Promise<void> {
  console.log(`[Stage 6] Processing publish batch with ${batch.messages.length} message(s)`);

  for (const msg of batch.messages) {
    const message = msg.body;
    console.log(`[Stage 6] Publishing for generate ID: ${message.generateId}`);
      
      console.log('[Stage 6] Ghost key format check:', env.GHOST_ADMIN_API_KEY ? `${env.GHOST_ADMIN_API_KEY.substring(0,20)}...` : 'EMPTY/UNDEFINED');

    try {
      // Dedup check
      const dedupKey = `published:${message.generateId}`;
      const alreadyPublished = await env.INGEST_STATE.get(dedupKey);
      if (alreadyPublished) {
        console.log(`[Stage 6] Already published: ${message.generateId} — skipping`);
        continue;
      }

      // Parse subject line from first line of newsletter (# Subject Line)
      const lines = message.newsletter.split('\n');
      const title = lines[0].replace(/^#\s+/, '').trim() || `AI Newsletter — ${message.dates[0]}`;

      // Parse custom_excerpt from the line that starts with "PLUS:"
      const preheaderIndex = lines.findIndex((l, i) => i > 0 && l.trim().startsWith('PLUS:'));
      const preheader = preheaderIndex >= 0 ? lines[preheaderIndex].trim() : '';

      // Strip title and preheader from body - Ghost displays them separately
      const bodyLines = lines.filter((line, index) => {
        if (index === 0 && line.startsWith('# ')) return false;
        if (index === preheaderIndex) return false;
        return true;
      });
      
      const bodyMarkdown = bodyLines.join('\n');

      const html = markdownToHtml(bodyMarkdown.trim());
      
      // Use mobiledoc format with HTML card — Ghost's html field is unreliable
      // and silently drops content. Mobiledoc HTML cards are stored as-is.
      const mobiledoc = JSON.stringify({
        version: '0.3.1',
        atoms: [],
        cards: [['html', { html }]],
        markups: [],
        sections: [[10, 0]],
      });
      
      console.log(`[Stage 6] Body: ${bodyMarkdown.length} chars → HTML: ${html.length} chars`);

      // Create Ghost JWT
      const jwt = await createGhostJwt(env.GHOST_ADMIN_API_KEY);

      // Post to Ghost Admin API as draft
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

      console.log(`[Stage 6] ✓ Ghost draft created — ID: ${post.id}`);
      console.log(`[Stage 6] ✓ URL: ${post.url}`);

      // Mark as published in KV
      await env.INGEST_STATE.put(dedupKey, JSON.stringify({
        postId: post.id,
        postUrl: post.url,
        title,
        timestamp: Date.now(),
      }), { expirationTtl: 60 * 60 * 24 * 30 }); // 30 days

    } catch (error) {
      console.error(`[Stage 6] Publish failed for ${message.generateId}:`, error);

      await env.INGEST_STATE.put(
        `error:publish:${message.generateId}`,
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        }),
        { expirationTtl: 60 * 60 * 24 * 7 }
      );

      throw error; // Let queue retry
    }
  }
}
