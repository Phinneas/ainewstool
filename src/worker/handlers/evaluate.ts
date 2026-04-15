/**
 * Stage 3: Evaluate relevance and extract external sources
 * Consumes messages from evaluate-queue, enqueues to upload-queue
 *
 * Resilience design:
 * - Each item is processed in its own try/catch — one bad article never blocks others
 * - Each message is ack'd or retry'd individually — no full-batch retries on item errors
 * - SurrealDB failures are tracked in KV under db-fail: prefix so drift is visible
 * - Relevance scores are floats: research items use normalized 1–10 score, news uses 0/1
 */

import { Env } from '../index.js';
import { evaluateContentRelevance } from '../../../src/ingest/evaluate.js';
import { extractExternalSources } from '../../../src/ingest/extract-sources.js';
import { apiKeys } from '../../../src/llm/api-keys.js';
import { createSurrealClient } from '../lib/surreal.js';
import { Logger, PipelineMetrics, ingestIdFromBatchId } from '../lib/logger.js';
import type { EvaluateMessage, UploadMessage } from '../types.js';

// Track a SurrealDB write failure in KV so the /status endpoint can surface drift.
// Fire-and-forget — never blocks the evaluation path.
async function trackDbFailure(
  kv: KVNamespace,
  stage: string,
  url: string,
  error: string
): Promise<void> {
  try {
    const key = `db-fail:${stage}:${Date.now()}`;
    await kv.put(key, JSON.stringify({ url, error, ts: new Date().toISOString() }), {
      expirationTtl: 86400, // 24 hours — enough to catch on-call
    });
  } catch {
    // KV itself is down — nothing we can do, don't cascade
  }
}

export async function handleEvaluateQueue(batch: MessageBatch<EvaluateMessage>, env: Env): Promise<void> {
  const log = new Logger('stage-3');
  log.info('evaluate batch received', { messages: batch.messages.length });

  // Set global API keys
  apiKeys.mistral = env.MISTRAL_API_KEY;
  apiKeys.anthropic = env.ANTHROPIC_API_KEY;
  apiKeys.moonshot = env.MOONSHOT_API_KEY;
  if (env.EXA_API_KEY) process.env.EXA_API_KEY = env.EXA_API_KEY;
  if (env.TAVILY_API_KEY) process.env.TAVILY_API_KEY = env.TAVILY_API_KEY;
  if (env.PARALLEL_API_KEY) process.env.PARALLEL_API_KEY = env.PARALLEL_API_KEY;

  const db = createSurrealClient(env);

  for (const msg of batch.messages) {
    const message = msg.body;
    const ingestId = ingestIdFromBatchId(message.batchId);
    const batchLog = log.withContext(ingestId);
    const metrics = new PipelineMetrics(env.INGEST_STATE, ingestId);

    const evaluatedItems = [];
    let cacheHits = 0;
    let rejected = 0;
    let itemErrors = 0;

    for (const { item, scrapeKey } of message.items) {
      // ── Per-item isolation: one bad article never kills the rest ──────────
      try {
        batchLog.debug('evaluating item', { title: item.title });

        const cacheKey = `evaluate:${item.uploadFileName}`;
        const cached = await env.INGEST_STATE.get(cacheKey);

        if (cached) {
          batchLog.debug('evaluate cache hit', { title: item.title });
          cacheHits++;
          const cachedResult = JSON.parse(cached);
          if (cachedResult.isRelevant) {
            evaluatedItems.push({
              item: cachedResult.item,
              scrapeKey: cachedResult.scrapeKey || scrapeKey,
              externalSources: cachedResult.externalSources,
              isRelevant: true,
              relevanceReason: cachedResult.relevanceReason,
            });
          }
          continue;
        }

        const scrapeData = await env.INGEST_STATE.get(scrapeKey);
        if (!scrapeData) {
          batchLog.warn('no scrape data in kv', { title: item.title, key: scrapeKey });
          continue;
        }
        const scrapeResult = JSON.parse(scrapeData);

        const evaluation = await evaluateContentRelevance(scrapeResult.content);

        // ── Relevance score: float not binary ─────────────────────────────
        // Research items carry a 1–10 score from the LLM; normalize to 0–1.
        // News/project items are binary pass/fail — use 1.0 / 0.0.
        const relevanceScore = typeof evaluation.score === 'number'
          ? Math.round((evaluation.score / 10) * 100) / 100
          : evaluation.isRelevant ? 1.0 : 0.0;

        if (!evaluation.isRelevant) {
          batchLog.debug('item rejected', { title: item.title, reason: evaluation.reasoning });
          rejected++;
          await env.INGEST_STATE.put(
            cacheKey,
            JSON.stringify({ item, isRelevant: false, reasoning: evaluation.reasoning }),
            { expirationTtl: 86400 }
          );
          if (db) {
            db.updateArticle(item.url, {
              status: 'rejected',
              relevanceScore,
              evalModel: 'mistral',
              rejectionReason: evaluation.reasoning.slice(0, 500),
            }).catch(err => {
              const errMsg = err instanceof Error ? err.message : String(err);
              batchLog.warn('surrealdb reject update failed', { error: errMsg, url: item.url });
              trackDbFailure(env.INGEST_STATE, 'evaluate-reject', item.url, errMsg);
            });
          }
          continue;
        }

        const externalSources = await extractExternalSources(scrapeResult);
        const result = {
          item,
          scrapeKey,
          externalSources,
          isRelevant: true,
          relevanceReason: evaluation.reasoning,
          relevanceScore,
        };

        await env.INGEST_STATE.put(cacheKey, JSON.stringify(result), { expirationTtl: 604800 });

        if (db) {
          db.updateArticle(item.url, {
            status: 'evaluated',
            relevanceScore,
            evalModel: 'mistral',
          }).catch(err => {
            const errMsg = err instanceof Error ? err.message : String(err);
            batchLog.warn('surrealdb eval update failed', { error: errMsg, url: item.url });
            trackDbFailure(env.INGEST_STATE, 'evaluate-accept', item.url, errMsg);
          });
        }

        evaluatedItems.push(result);

      } catch (itemErr) {
        // Item-level failure — log it, count it, keep going
        itemErrors++;
        batchLog.error('item evaluation failed', {
          title: item.title,
          url: item.url,
          error: itemErr instanceof Error ? itemErr.message : String(itemErr),
        });
      }
    }

    // ── Metrics & enqueue regardless of per-item failures ─────────────────
    await metrics.increment('evaluated', message.items.length);
    await metrics.increment('relevant', evaluatedItems.length);
    await metrics.increment('rejected', rejected);
    if (cacheHits > 0) await metrics.increment('evaluate_cache_hits', cacheHits);
    if (itemErrors > 0) await metrics.increment('evaluate_item_errors', itemErrors);

    batchLog.info('evaluate batch done', {
      batch_id: message.batchId,
      evaluated: message.items.length,
      relevant: evaluatedItems.length,
      rejected,
      cache_hits: cacheHits,
      item_errors: itemErrors,
    });

    if (evaluatedItems.length > 0) {
      const uploadMessage: UploadMessage = {
        type: 'batch',
        items: evaluatedItems,
        batchId: message.batchId,
        timestamp: Date.now(),
      };
      await env.UPLOAD_QUEUE.send(uploadMessage);
      batchLog.debug('enqueued for upload', { count: evaluatedItems.length });
    }

    // ── Explicit ack/retry per message ────────────────────────────────────
    // Ack unconditionally: item-level errors are already logged and counted.
    // We never want to retry an entire message just because one article failed.
    msg.ack();
  }
}
