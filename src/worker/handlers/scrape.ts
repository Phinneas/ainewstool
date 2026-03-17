/**
 * Stage 2: Scrape URLs via Firecrawl
 * Consumes messages from scrape-queue, enqueues to evaluate-queue
 */

import { Env } from '../index.js';
import { scrapeUrl } from '../../../src/ingest/scrape.js';
import { Logger, PipelineMetrics, ingestIdFromBatchId } from '../lib/logger.js';
import type { ScrapeMessage, EvaluateMessage } from '../types.js';

export async function handleScrapeQueue(batch: MessageBatch<ScrapeMessage>, env: Env): Promise<void> {
  const log = new Logger('stage-2');
  log.info('scrape batch received', { messages: batch.messages.length });

  for (const msg of batch.messages) {
    const message = msg.body;
    const ingestId = ingestIdFromBatchId(message.batchId);
    const batchLog = log.withContext(ingestId);
    const metrics = new PipelineMetrics(env.INGEST_STATE, ingestId);

    try {
      const scrapedItems = [];
      let cacheHits = 0;
      let scrapeFailures = 0;

      for (const itemData of message.items) {
        batchLog.debug('scraping item', { title: itemData.title, url: itemData.url });

        const cacheKey = `scrape:${itemData.uploadFileName}`;
        const cached = await env.INGEST_STATE.get(cacheKey);

        if (cached) {
          batchLog.debug('scrape cache hit', { title: itemData.title });
          cacheHits++;
          scrapedItems.push({ item: itemData, scrapeKey: cacheKey });
          continue;
        }

        const result = await scrapeUrl(itemData.url, env.FIRECRAWL_API_KEY);

        if (!result || !result.content) {
          batchLog.warn('scrape failed', { title: itemData.title, url: itemData.url });
          scrapeFailures++;
          await env.INGEST_STATE.put(
            `failed:scrape:${itemData.uploadFileName}`,
            JSON.stringify({ timestamp: Date.now(), reason: 'scrape_failed' }),
            { expirationTtl: 86400 }
          );
          continue;
        }

        await env.INGEST_STATE.put(cacheKey, JSON.stringify(result), {
          expirationTtl: 604800,
        });

        scrapedItems.push({ item: itemData, scrapeKey: cacheKey });
      }

      await metrics.increment('scraped', scrapedItems.length);
      if (cacheHits > 0) await metrics.increment('scrape_cache_hits', cacheHits);
      if (scrapeFailures > 0) await metrics.increment('scrape_failed', scrapeFailures);

      batchLog.info('scrape batch done', {
        batch_id: message.batchId,
        scraped: scrapedItems.length,
        cache_hits: cacheHits,
        failed: scrapeFailures,
      });

      if (scrapedItems.length > 0) {
        const evaluateMessage: EvaluateMessage = {
          type: 'batch',
          items: scrapedItems,
          batchId: message.batchId,
          timestamp: Date.now(),
        };
        await env.EVALUATE_QUEUE.send(evaluateMessage);
        batchLog.debug('enqueued for evaluation', { count: scrapedItems.length });
      }

    } catch (error) {
      const batchLog2 = log.withContext(ingestId);
      batchLog2.error('scrape batch error', {
        batch_id: message.batchId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
