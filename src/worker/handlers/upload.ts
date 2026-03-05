/**
 * Stage 4: Upload to R2 storage
 * Consumes messages from upload-queue and stores content
 */

import { Env } from '../index.js';
import type { UploadMessage } from '../types.js';

export async function handleUploadQueue(batch: MessageBatch<UploadMessage>, env: Env): Promise<void> {
  console.log(`[Stage 4] Processing upload batch with ${batch.messages.length} messages`);
  
  for (const msg of batch.messages) {
    const message = msg.body;
    
    for (const { item, scrapeKey, externalSources } of message.items) {
      try {
        console.log(`[Stage 4] Uploading: ${item.title}`);

        // Check if already uploaded
        const uploadKey = `upload:${item.uploadFileName}`;
        const uploaded = await env.INGEST_STATE.get(uploadKey);

        if (uploaded) {
          console.log(`[Stage 4] Already uploaded: ${item.title}`);
          continue;
        }

        // Fetch scrape result from KV (stored by Stage 2, keyed by scrapeKey)
        const scrapeData = await env.INGEST_STATE.get(scrapeKey);
        if (!scrapeData) {
          console.error(`[Stage 4] No scrape data in KV for: ${item.title} (key: ${scrapeKey})`);
          continue;
        }
        const scrapeResult = JSON.parse(scrapeData);

        // Prepare metadata
        const metadata: Record<string, string> = {
          key: `${item.uploadFileName}.md`,
          type: item.feedType,
          title: item.title,
          authors: item.authors,
          'source-name': item.sourceName,
          'external-source-urls': externalSources,
          'image-urls': scrapeResult.mainContentImageUrls.join(','),
          url: item.url,
          timestamp: item.publishedTimestamp,
          'feed-url': item.feedUrl,
        };
        
        // Upload markdown to R2
        await env.CONTENT_BUCKET.put(
          `${item.uploadFileName}.md`,
          scrapeResult.content,
          {
            httpMetadata: {
              contentType: `application/vnd.aitools.${item.feedType}+md`,
            },
            customMetadata: metadata,
          }
        );
        
        // Upload raw HTML to R2
        await env.CONTENT_BUCKET.put(
          `${item.uploadFileName}.html`,
          scrapeResult.rawHtml,
          {
            httpMetadata: {
              contentType: `application/vnd.aitools.${item.feedType}.raw+html`,
            },
            customMetadata: metadata,
          }
        );
        
        // Mark as uploaded in KV
        await env.INGEST_STATE.put(uploadKey, JSON.stringify({
          timestamp: Date.now(),
          status: 'uploaded',
          metadata,
        }));
        
        // Also mark the original item as processed
        await env.INGEST_STATE.put(
          `item:${item.uploadFileName}`,
          JSON.stringify({
            timestamp: Date.now(),
            status: 'completed',
          })
        );
        
        console.log(`[Stage 4] Successfully uploaded: ${item.title}`);
        
      } catch (error) {
        console.error(`[Stage 4] Error uploading ${item.title}:`, error);
        // Don't throw - continue with other items
        // Store failure for retry
        await env.INGEST_STATE.put(
          `failed:upload:${item.uploadFileName}`,
          JSON.stringify({
            timestamp: Date.now(),
            error: error instanceof Error ? error.message : String(error),
          }),
          { expirationTtl: 86400 } // Retry after 24 hours
        );
      }
    }
  }
}
