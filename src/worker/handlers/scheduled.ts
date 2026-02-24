/**
 * Stage 1: Fetch feeds and enqueue URLs for scraping
 * Triggered by scheduled event (cron) or manual trigger
 */

import { Env } from '../index.js';
import { ALL_FEEDS } from '../lib/feeds-bundler.js';
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
  console.log('=== STAGE 1: FEED FETCH STARTED ===');
  console.log(`Time: ${new Date().toISOString()}`);
  
  // Generate unique ingestion ID
  const ingestionId = `ingest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  console.log(`Ingestion ID: ${ingestionId}`);
  
  try {
    console.log('[Stage 1] Step 1: Fetching all feeds...');
    // Fetch all feed items
    const items = await fetchAllFeedsWorker(env);
    console.log(`[Stage 1] ✓ Fetched ${items.length} raw items`);
    
    if (items.length === 0) {
      console.warn('[Stage 1] ⚠️ No items fetched - this is unexpected!');
      // Store debug info
      await env.INGEST_STATE.put(`debug:empty-fetch:${Date.now()}`, JSON.stringify({
        feedsCount: ALL_FEEDS.length,
        enabledFeedsCount: ALL_FEEDS.filter(f => f.enabled).length,
        timestamp: Date.now()
      }), { expirationTtl: 86400 });
      return;
    }
    
    console.log('[Stage 1] Step 2: Filtering existing items...');
    
    // DEBUG: Check if this is first run
    console.log('[DEBUG] Checking if KV is empty...');
    const kvList = await env.INGEST_STATE.list({ limit: 1 });
    const isFirstRun = kvList.keys.length === 0;
    console.log(`[DEBUG] KV empty? ${isFirstRun} (found ${kvList.keys.length} keys)`);
    
    let newItems: NormalizedFeedItem[];
    
    if (isFirstRun) {
      console.log('[Stage 1] First run detected - skipping deduplication check');
      newItems = items;
    } else {
      // Filter out existing items using KV
      newItems = await filterExistingItems(items, env);
    }
    
    console.log(`[Stage 1] ✓ ${newItems.length} new items after deduplication`);
    
    if (newItems.length === 0) {
      console.log('[Stage 1] No new items to process (all already exist)');
      return;
    }
    
    console.log('[Stage 1] Step 3: Batching items...');
    // Batch and enqueue for scraping
    const batches = createBatches(newItems, SCRAPE_BATCH_SIZE);
    console.log(`[Stage 1] ✓ Created ${batches.length} batches of ${SCRAPE_BATCH_SIZE} items each`);
    
    console.log('[Stage 1] Step 4: Enqueueing to scrape-queue...');
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[Stage 1]   → Enqueueing batch ${i + 1}/${batches.length} (${batch.length} items)`);
      
      const message: ScrapeMessage = {
        type: 'batch',
        items: batch,
        batchId: `${ingestionId}-batch-${i}`,
        timestamp: Date.now(),
      };
      
      await env.SCRAPE_QUEUE.send(message);
      console.log(`[Stage 1]   ✓ Batch ${i + 1} enqueued`);
    }
    
    console.log('[Stage 1] Step 5: Saving ingestion state to KV...');
    // Track ingestion in KV
    const stateData = {
      status: 'started',
      totalItems: newItems.length,
      batches: batches.length,
      startTime: Date.now(),
      ingestionId,
    };
    
    await env.INGEST_STATE.put(`ingest:${ingestionId}`, JSON.stringify(stateData));
    console.log(`[Stage 1] ✓ State saved: ingest:${ingestionId}`);
    console.log(`[Stage 1] ✓ COMPLETED successfully!`);
    console.log('=== STAGE 1: FEED FETCH FINISHED ===');
    
  } catch (error) {
    console.error('🔥 STAGE 1 FAILED 🔥');
    console.error('Error:', error);
    
    // Store error in KV for debugging
    await env.INGEST_STATE.put(`error:stage1:${Date.now()}`, JSON.stringify({
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
  env: Env
): Promise<NormalizedFeedItem[]> {
  console.log(`[Deduplication] Checking ${items.length} items against KV...`);
  
  const newItems: NormalizedFeedItem[] = [];
  let existingCount = 0;
  let errorCount = 0;
  
  // Check KV for existing items in parallel
  const checks = await Promise.allSettled(
    items.map(async (item) => {
      const key = `item:${item.uploadFileName}`;
      try {
        const exists = await env.INGEST_STATE.get(key);
        return { item, exists: exists !== null, key };
      } catch (error) {
        console.warn(`[Deduplication] Error checking key: ${key}`, error);
        return { item, exists: false, key, error };
      }
    })
  );
  
  for (const result of checks) {
    if (result.status === 'fulfilled') {
      if (result.value.exists) {
        existingCount++;
        if (existingCount <= 5) { // Log first 5 to avoid spam
          console.log(`[Deduplication] ⚠️ Already exists: ${result.value.key}`);
        }
      } else {
        newItems.push(result.value.item);
      }
    } else {
      errorCount++;
    }
  }
  
  console.log(`[Deduplication] Results: ${newItems.length} new, ${existingCount} existing, ${errorCount} errors`);
  
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
 * Enqueues a generate message covering the last 7 days of R2 content.
 */
export async function handleGenerateCron(env: Env): Promise<void> {
  console.log('=== GENERATE CRON TRIGGERED ===');
  const today = new Date();

  // Build list of date prefixes for the last 7 days
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD
  }

  const generateId = `generate-${today.toISOString().slice(0, 10)}-${Date.now()}`;
  console.log(`Generate ID: ${generateId}`);
  console.log(`Date range: ${dates[dates.length - 1]} to ${dates[0]}`);

  await env.GENERATE_QUEUE.send({
    type: 'generate',
    generateId,
    dates,
    timestamp: Date.now(),
  });

  console.log('=== GENERATE CRON: message enqueued ===');
}
