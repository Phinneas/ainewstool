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
import {
  evaluateContentRelevance,
  detectContentType,
  type EvalProvider,
} from '../../../src/ingest/evaluate.js';
import { extractExternalSources } from '../../../src/ingest/extract-sources.js';
import { apiKeys } from '../../../src/llm/api-keys.js';
import { createSurrealClient } from '../lib/surreal.js';
import { Logger, PipelineMetrics, ingestIdFromBatchId } from '../lib/logger.js';
import type { EvaluateMessage, UploadMessage } from '../types.js';

/** `shadow` runs both providers and acts on Mistral, for threshold calibration. */
type EvalMode = 'mistral' | 'jev' | 'shadow';

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
  apiKeys.anthropicModel = env.ANTHROPIC_MODEL ?? '';
  apiKeys.moonshot = env.MOONSHOT_API_KEY;
  apiKeys.openrouter = env.OPENROUTER_API_KEY ?? '';
  if (env.EXA_API_KEY) process.env.EXA_API_KEY = env.EXA_API_KEY;
  if (env.TAVILY_API_KEY) process.env.TAVILY_API_KEY = env.TAVILY_API_KEY;
  if (env.PARALLEL_API_KEY) process.env.PARALLEL_API_KEY = env.PARALLEL_API_KEY;

  // Plain vars -> process.env, matching the key pattern above. evaluate.ts
  // resolves provider/threshold/budget from there so the CLI and discovery
  // callers get identical behaviour without threading settings through.
  if (env.EVAL_PROVIDER) process.env.EVAL_PROVIDER = env.EVAL_PROVIDER;
  if (env.RELEVANCE_THRESHOLD) process.env.RELEVANCE_THRESHOLD = env.RELEVANCE_THRESHOLD;
  if (env.STATE_CHAR_BUDGET) process.env.STATE_CHAR_BUDGET = env.STATE_CHAR_BUDGET;

  // `shadow` calls both providers, ACTS ON MISTRAL, and logs the Jev answer so
  // the threshold can be picked from measured agreement before cutover.
  const mode: EvalMode =
    env.EVAL_PROVIDER === 'jev' || env.EVAL_PROVIDER === 'shadow' ? env.EVAL_PROVIDER : 'mistral';
  const actingProvider: EvalProvider = mode === 'shadow' ? 'mistral' : mode;
  // Written to SurrealDB `eval_model`. Shadow is labelled distinctly so the
  // analytics never attribute a Mistral decision to Jev.
  const evalModelLabel = mode === 'shadow' ? 'mistral:shadow' : actingProvider;
  log.info('evaluate provider mode', { mode, acting_provider: actingProvider });

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
    // Accumulated locally and written once, so per-item KV round-trips don't
    // scale with batch size. `usage.cost` is USD, straight from OpenRouter —
    // recorded rather than estimated from token counts.
    let jevInputTokens = 0;
    let jevCostUsd = 0;
    let jevCalls = 0;
    let truncatedItems = 0;
    let shadowDisagreements = 0;
    let shadowErrors = 0;

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

        // Detect content type for proper evaluation
        const contentType = detectContentType(item);
        const evaluation = await evaluateContentRelevance(scrapeResult.content, contentType, {
          provider: actingProvider,
          sessionId: message.batchId,
        });

        if (evaluation.usage) {
          jevCalls++;
          jevInputTokens += evaluation.usage.inputTokens ?? 0;
          jevCostUsd += evaluation.usage.cost ?? 0;
        }
        if (evaluation.truncated) {
          truncatedItems++;
          batchLog.warn('content bounded to fit state budget', {
            title: item.title,
            content_type: contentType,
          });
        }

        // Shadow mode: also ask Jev, but ACT ON MISTRAL. The logged comparison
        // is what RELEVANCE_THRESHOLD gets picked from — see SPEC-judge-with-jev.
        // Failures here must never affect the real decision.
        if (mode === 'shadow') {
          try {
            const shadowEval = await evaluateContentRelevance(scrapeResult.content, contentType, {
              provider: 'jev',
              sessionId: message.batchId,
            });
            jevCalls++;
            jevInputTokens += shadowEval.usage?.inputTokens ?? 0;
            jevCostUsd += shadowEval.usage?.cost ?? 0;
            if (shadowEval.truncated) truncatedItems++;
            const agrees = shadowEval.isRelevant === evaluation.isRelevant;
            if (!agrees) shadowDisagreements++;
            batchLog.info('shadow jev comparison', {
              url: item.url,
              content_type: contentType,
              mistral_relevant: evaluation.isRelevant,
              mistral_score: evaluation.score,
              jev_relevant: shadowEval.isRelevant,
              jev_probability: shadowEval.probability,
              jev_score: shadowEval.score,
              jev_tag: shadowEval.rejectionTag,
              agrees,
              input_tokens: shadowEval.usage?.inputTokens,
              cost_usd: shadowEval.usage?.cost,
            });
          } catch (shadowErr) {
            shadowErrors++;
            batchLog.warn('shadow jev call failed', {
              url: item.url,
              error: shadowErr instanceof Error ? shadowErr.message : String(shadowErr),
            });
          }
        }

        // ── Relevance score: float not binary ─────────────────────────────
        // Research items carry a 1–10 score; normalize to 0–1.
        // Jev news items carry a calibrated noul probability — use it directly,
        // which is strictly more information than the old 1.0/0.0.
        // Mistral news items are binary pass/fail — fall back to 1.0 / 0.0.
        const relevanceScore = typeof evaluation.score === 'number'
          ? Math.round((evaluation.score / 10) * 100) / 100
          : typeof evaluation.probability === 'number'
            ? Math.round(evaluation.probability * 100) / 100
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
              evalModel: evalModelLabel,
              // Jev produces no prose, so the tag is the queryable reason. The
              // full summary ("tag=… noul=… conf=…") stays in the debug log above.
              rejectionReason: (evaluation.rejectionTag ?? evaluation.reasoning).slice(0, 500),
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
            evalModel: evalModelLabel,
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
    if (jevCalls > 0) {
      await metrics.increment('jev_calls', jevCalls);
      await metrics.increment('jev_input_tokens', jevInputTokens);
      // Rounded to microdollars — KV accumulation of raw floats drifts.
      await metrics.increment('jev_cost_micro_usd', Math.round(jevCostUsd * 1e6));
    }
    if (truncatedItems > 0) await metrics.increment('evaluate_truncated', truncatedItems);
    if (mode === 'shadow') {
      await metrics.increment('shadow_compared', jevCalls);
      await metrics.increment('shadow_disagreements', shadowDisagreements);
      if (shadowErrors > 0) await metrics.increment('shadow_errors', shadowErrors);
    }

    batchLog.info('evaluate batch done', {
      batch_id: message.batchId,
      evaluated: message.items.length,
      relevant: evaluatedItems.length,
      rejected,
      cache_hits: cacheHits,
      item_errors: itemErrors,
      mode,
      jev_calls: jevCalls,
      jev_input_tokens: jevInputTokens,
      jev_cost_usd: Number(jevCostUsd.toFixed(6)),
      truncated_items: truncatedItems,
      shadow_disagreements: shadowDisagreements,
      shadow_errors: shadowErrors,
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
