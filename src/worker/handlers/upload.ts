/**
 * Stage 4: Upload to R2 storage
 * Consumes messages from upload-queue and stores content
 */

import { Env } from '../index.js';
import { Logger, PipelineMetrics, ingestIdFromBatchId } from '../lib/logger.js';
import type { UploadMessage } from '../types.js';

export async function handleUploadQueue(batch: MessageBatch<UploadMessage>, env: Env): Promise<void> {
  const log = new Logger('stage-4');
  log.info('upload batch received', { messages: batch.messages.length });

  for (const msg of batch.messages) {
    const message = msg.body;
    const ingestId = ingestIdFromBatchId(message.batchId);
    const batchLog = log.withContext(ingestId);
    const metrics = new PipelineMetrics(env.INGEST_STATE, ingestId);

    let uploaded = 0;
    let skipped = 0;
    let failed = 0;

    for (const { item, scrapeKey, externalSources } of message.items) {
      try {
        batchLog.debug('uploading item', { title: item.title });

        const uploadKey = `upload:${item.uploadFileName}`;
        const alreadyUploaded = await env.INGEST_STATE.get(uploadKey);
        if (alreadyUploaded) {
          batchLog.debug('already uploaded', { title: item.title });
          skipped++;
          continue;
        }

        const scrapeData = await env.INGEST_STATE.get(scrapeKey);
        if (!scrapeData) {
          batchLog.error('no scrape data in kv', { title: item.title, key: scrapeKey });
          failed++;
          continue;
        }
        const scrapeResult = JSON.parse(scrapeData);

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

        await env.CONTENT_BUCKET.put(
          `${item.uploadFileName}.md`,
          scrapeResult.content,
          {
            httpMetadata: { contentType: `application/vnd.aitools.${item.feedType}+md` },
            customMetadata: metadata,
          }
        );

        await env.CONTENT_BUCKET.put(
          `${item.uploadFileName}.html`,
          scrapeResult.rawHtml,
          {
            httpMetadata: { contentType: `application/vnd.aitools.${item.feedType}.raw+html` },
            customMetadata: metadata,
          }
        );

        await env.INGEST_STATE.put(uploadKey, JSON.stringify({
          timestamp: Date.now(),
          status: 'uploaded',
          metadata,
        }));

        await env.INGEST_STATE.put(
          `item:${item.uploadFileName}`,
          JSON.stringify({ timestamp: Date.now(), status: 'completed' })
        );

        uploaded++;
        batchLog.debug('upload complete', { title: item.title });

      } catch (error) {
        batchLog.error('upload failed', {
          title: item.title,
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
        await env.INGEST_STATE.put(
          `failed:upload:${item.uploadFileName}`,
          JSON.stringify({
            timestamp: Date.now(),
            error: error instanceof Error ? error.message : String(error),
          }),
          { expirationTtl: 86400 }
        );
      }
    }

    await metrics.increment('uploaded', uploaded);
    if (skipped > 0) await metrics.increment('upload_skipped', skipped);
    if (failed > 0) await metrics.increment('upload_failed', failed);

    batchLog.info('upload batch done', {
      batch_id: message.batchId,
      uploaded,
      skipped,
      failed,
    });
  }
}
