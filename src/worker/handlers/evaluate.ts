/**
 * Stage 3: Evaluate relevance and extract external sources
 * Consumes messages from evaluate-queue, enqueues to upload-queue
 */

import { Env } from '../index.js';
import { evaluateContentRelevance } from '../../../src/ingest/evaluate.js';
import { extractExternalSources } from '../../../src/ingest/extract-sources.js';
import { apiKeys } from '../../../src/llm/api-keys.js';
import { createSurrealClient } from '../lib/surreal.js';
import { Logger, PipelineMetrics, ingestIdFromBatchId } from '../lib/logger.js';
import type { EvaluateMessage, UploadMessage } from '../types.js';

export async function handleEvaluateQueue(batch: MessageBatch<EvaluateMessage>, env: Env): Promise<void> {
  const log = new Logger('stage-3');
  log.info('evaluate batch received', { messages: batch.messages.length });

  // Set global API keys
  apiKeys.mistral = env.MISTRAL_API_KEY;
  apiKeys.anthropic = env.ANTHROPIC_API_KEY;
  apiKeys.moonshot = env.MOONSHOT_API_KEY;
  if (env.Exa) process.env.EXA_API_KEY = env.Exa;
  if (env.TAVILY_API_KEY) process.env.TAVILY_API_KEY = env.TAVILY_API_KEY;

  const db = createSurrealClient(env);

  for (const msg of batch.messages) {
    const message = msg.body;
    const ingestId = ingestIdFromBatchId(message.batchId);
    const batchLog = log.withContext(ingestId);
    const metrics = new PipelineMetrics(env.INGEST_STATE, ingestId);

    try {
      const evaluatedItems = [];
      let cacheHits = 0;
      let rejected = 0;

      for (const { item, scrapeKey } of message.items) {
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
              relevanceScore: 0.0,
              evalModel: 'mistral',
              rejectionReason: evaluation.reasoning.slice(0, 500),
            }).catch(err => batchLog.warn('surrealdb reject update failed', { error: err instanceof Error ? err.message : String(err) }));
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
        };

        await env.INGEST_STATE.put(cacheKey, JSON.stringify(result), { expirationTtl: 604800 });

        if (db) {
          db.updateArticle(item.url, {
            status: 'evaluated',
            relevanceScore: 1.0,
            evalModel: 'mistral',
          }).catch(err => batchLog.warn('surrealdb eval update failed', { error: err instanceof Error ? err.message : String(err) }));
        }

        evaluatedItems.push(result);
      }

      await metrics.increment('evaluated', message.items.length);
      await metrics.increment('relevant', evaluatedItems.length);
      await metrics.increment('rejected', rejected);
      if (cacheHits > 0) await metrics.increment('evaluate_cache_hits', cacheHits);

      batchLog.info('evaluate batch done', {
        batch_id: message.batchId,
        evaluated: message.items.length,
        relevant: evaluatedItems.length,
        rejected,
        cache_hits: cacheHits,
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

    } catch (error) {
      const batchLog2 = log.withContext(ingestId);
      batchLog2.error('evaluate batch error', {
        batch_id: message.batchId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
