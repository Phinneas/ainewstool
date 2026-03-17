/**
 * Stage 1: Fetch feeds and enqueue URLs for scraping
 * Triggered by scheduled event (cron) or manual trigger
 */

import { Env } from '../index.js';
import { ALL_FEEDS } from '../lib/feeds-bundler.js';
import { createSurrealClient } from '../lib/surreal.js';
import { Logger, PipelineMetrics } from '../lib/logger.js';
import type { ScrapeMessage } from '../types.js';

// Batch size for queue messages (reduced to stay under 128KB limit)
// Each item can be ~10-15KB with full metadata, so limit to 5 items per batch
const SCRAPE_BATCH_SIZE = 5;

interface NormalizedFeedItem {
  url: string;
  title: string;
  sourceName: string;
  feedType: string;
  feedUrl: string;
  uploadFileName: string;
  authors: string;
  publishedTimestamp: string;
}

export async function handleScheduled(env: Env): Promise<void> {
  // Generate unique ingestion ID
  const ingestionId = `ingest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const log = new Logger('stage-1').withContext(ingestionId);
  const metrics = new PipelineMetrics(env.INGEST_STATE, ingestionId);

  log.info('feed fetch started');

  try {
    log.info('fetching all feeds');
    const allFetchedItems = await fetchAllFeedsWorker(env);
    log.info('feeds fetched', { count: allFetchedItems.length });
    await metrics.set('run_id', ingestionId);
    await metrics.set('started_at', Date.now());

    // Drop articles older than 30 days
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const items = allFetchedItems.filter(item => {
      if (!item.publishedTimestamp) return true;
      const ts = new Date(item.publishedTimestamp).getTime();
      return isNaN(ts) || ts >= cutoff;
    });
    const dropped = allFetchedItems.length - items.length;
    if (dropped > 0) {
      log.info('dropped old items', { dropped, remaining: items.length });
    }
    await metrics.increment('fetched', items.length);

    if (items.length === 0) {
      log.warn('no items fetched — unexpected');
      await env.INGEST_STATE.put(`debug:empty-fetch:${Date.now()}`, JSON.stringify({
        feedsCount: ALL_FEEDS.length,
        enabledFeedsCount: ALL_FEEDS.filter(f => f.enabled).length,
        timestamp: Date.now()
      }), { expirationTtl: 86400 });
      return;
    }

    log.info('filtering existing items');
    const kvList = await env.INGEST_STATE.list({ limit: 1 });
    const isFirstRun = kvList.keys.length === 0;

    let newItems: NormalizedFeedItem[];
    if (isFirstRun) {
      log.info('first run — skipping deduplication');
      newItems = items;
    } else {
      newItems = await filterExistingItems(items, env, log);
    }

    log.info('deduplication complete', { new: newItems.length, existing: items.length - newItems.length });
    await metrics.increment('new_after_dedup', newItems.length);
    await metrics.increment('deduped_out', items.length - newItems.length);

    if (newItems.length === 0) {
      log.info('no new items to process');
      return;
    }

    // Batch and enqueue for scraping
    const batches = createBatches(newItems, SCRAPE_BATCH_SIZE);
    log.info('batches created', { batches: batches.length, batch_size: SCRAPE_BATCH_SIZE });

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      // Claim each item in KV immediately
      await Promise.all(batch.map(item =>
        env.INGEST_STATE.put(
          `item:${item.uploadFileName}`,
          JSON.stringify({ status: 'claimed', timestamp: Date.now() }),
          { expirationTtl: 60 * 60 * 24 }
        )
      ));

      // Phase 1 dual-write: SurrealDB (non-blocking)
      const db = createSurrealClient(env);
      if (db) {
        Promise.allSettled(batch.map(async item => {
          const matchedFeed = ALL_FEEDS.find(f => item.feedUrl === f.feedUrl || item.sourceName === f.sourceName);
          if (matchedFeed) {
            await db.upsertSource({
              name:     matchedFeed.sourceName,
              url:      matchedFeed.feedUrl,
              feedType: matchedFeed.feedType,
              category: matchedFeed.category,
            });
          }
          await db.upsertArticle({
            title:       item.title,
            url:         item.url,
            uploadKey:   item.uploadFileName,
            sourceUrl:   item.feedUrl,
            publishedAt: item.publishedTimestamp || null,
            isPdf:       item.url.endsWith('.pdf'),
          });
        })).then(results => {
          const failed = results.filter(r => r.status === 'rejected').length;
          if (failed > 0) log.warn('surrealdb writes failed', { failed, total: batch.length });
        });
      }

      const message: ScrapeMessage = {
        type: 'batch',
        items: batch,
        batchId: `${ingestionId}-batch-${i}`,
        timestamp: Date.now(),
      };

      await env.SCRAPE_QUEUE.send(message);
      log.debug('batch enqueued', { batch: i + 1, of: batches.length, items: batch.length });
    }

    await metrics.increment('batches_enqueued', batches.length);

    // Track ingestion in KV
    await env.INGEST_STATE.put(`ingest:${ingestionId}`, JSON.stringify({
      status: 'started',
      totalItems: newItems.length,
      batches: batches.length,
      startTime: Date.now(),
      ingestionId,
    }));

    log.info('feed fetch complete', { total_new: newItems.length, batches: batches.length });

  } catch (error) {
    const log2 = new Logger('stage-1').withContext(ingestionId);
    log2.error('stage 1 failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    await env.INGEST_STATE.put(`error:stage1:${Date.now()}`, JSON.stringify({
      run_id: ingestionId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: Date.now(),
    }), { expirationTtl: 86400 });

    throw error;
  }
}

// Worker-optimized feed fetching
async function fetchAllFeedsWorker(env: Env): Promise<NormalizedFeedItem[]> {
  const { feedFetcher } = await import('../lib/fetcher.js');
  return feedFetcher.fetchAllFeeds();
}

async function filterExistingItems(
  items: NormalizedFeedItem[],
  env: Env,
  log: Logger
): Promise<NormalizedFeedItem[]> {
  log.debug('deduplication check', { checking: items.length });

  const newItems: NormalizedFeedItem[] = [];
  let existingCount = 0;
  let errorCount = 0;

  const checks = await Promise.allSettled(
    items.map(async (item) => {
      const key = `item:${item.uploadFileName}`;
      try {
        const exists = await env.INGEST_STATE.get(key);
        return { item, exists: exists !== null, key };
      } catch (error) {
        log.warn('kv check error', { key, error: error instanceof Error ? error.message : String(error) });
        return { item, exists: false, key, error };
      }
    })
  );

  for (const result of checks) {
    if (result.status === 'fulfilled') {
      result.value.exists ? existingCount++ : newItems.push(result.value.item);
    } else {
      errorCount++;
    }
  }

  log.debug('deduplication results', { new: newItems.length, existing: existingCount, errors: errorCount });
  return newItems;
}

function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Generate cron handler — fires on Wednesday and Saturday at 8am UTC.
 */
export async function handleGenerateCron(env: Env): Promise<void> {
  const today = new Date();
  const generateId = `generate-${today.toISOString().slice(0, 10)}-${Date.now()}`;
  const log = new Logger('stage-5-cron').withContext(generateId);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  log.info('generate cron triggered', {
    generate_id: generateId,
    date_range: `${dates[dates.length - 1]} to ${dates[0]}`,
  });

  await env.GENERATE_QUEUE.send({
    type: 'generate',
    generateId,
    dates,
    timestamp: Date.now(),
  });

  log.info('generate message enqueued');
}
