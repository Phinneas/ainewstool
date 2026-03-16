/**
 * Stage 3: Evaluate relevance and extract external sources
 * Consumes messages from evaluate-queue, enqueues to upload-queue
 */

import { Env } from '../index.js';
import { evaluateContentRelevance } from '../../../src/ingest/evaluate.js';
import { extractExternalSources } from '../../../src/ingest/extract-sources.js';
import { apiKeys } from '../../../src/llm/api-keys.js';
import { createSurrealClient } from '../lib/surreal.js';
import type { EvaluateMessage, UploadMessage } from '../types.js';

export async function handleEvaluateQueue(batch: MessageBatch<EvaluateMessage>, env: Env): Promise<void> {
  console.log(`[Stage 3] Processing evaluation batch with ${batch.messages.length} messages`);

  // Set global API keys so evaluate pipeline can call LLM APIs
  // (Workers don't reliably support process.env across modules)
  apiKeys.mistral = env.MISTRAL_API_KEY;
  apiKeys.anthropic = env.ANTHROPIC_API_KEY;
  apiKeys.moonshot = env.MOONSHOT_API_KEY;
  if (env.Exa) process.env.EXA_API_KEY = env.Exa;
  if (env.TAVILY_API_KEY) process.env.TAVILY_API_KEY = env.TAVILY_API_KEY;

  const db = createSurrealClient(env);

  for (const msg of batch.messages) {
    const message = msg.body;

    try {
      const evaluatedItems = [];

      for (const { item, scrapeKey } of message.items) {
        console.log(`[Stage 3] Evaluating: ${item.title}`);

        // Check evaluate cache first
        const cacheKey = `evaluate:${item.uploadFileName}`;
        const cached = await env.INGEST_STATE.get(cacheKey);

        if (cached) {
          console.log(`[Stage 3] Already evaluated: ${item.title}`);
          const cachedResult = JSON.parse(cached);
          if (cachedResult.isRelevant) {
            // Support both new format (scrapeKey) and old cached format (scrapeResult inline)
            const uploadItem = {
              item: cachedResult.item,
              scrapeKey: cachedResult.scrapeKey || scrapeKey,
              externalSources: cachedResult.externalSources,
              isRelevant: true,
              relevanceReason: cachedResult.relevanceReason,
            };
            evaluatedItems.push(uploadItem);
          }
          continue;
        }

        // Fetch scrape result from KV (stored by Stage 2)
        const scrapeData = await env.INGEST_STATE.get(scrapeKey);
        if (!scrapeData) {
          console.warn(`[Stage 3] No scrape data in KV for: ${item.title} (key: ${scrapeKey})`);
          continue;
        }
        const scrapeResult = JSON.parse(scrapeData);

        // Evaluate relevance
        const evaluation = await evaluateContentRelevance(scrapeResult.content);

        if (!evaluation.isRelevant) {
          console.log(`[Stage 3] Not relevant: ${item.title} - ${evaluation.reasoning}`);
          // Cache the negative result (but with shorter TTL)
          await env.INGEST_STATE.put(
            cacheKey,
            JSON.stringify({
              item,
              isRelevant: false,
              reasoning: evaluation.reasoning,
            }),
            { expirationTtl: 86400 } // 24 hours
          );
          // SurrealDB: mark rejected (non-blocking)
          if (db) {
            db.updateArticle(item.url, {
              status: 'rejected',
              relevanceScore: 0.0,
              evalModel: 'mistral',
              rejectionReason: evaluation.reasoning.slice(0, 500),
            }).catch(err => console.warn(`[Stage 3] SurrealDB reject update failed: ${err instanceof Error ? err.message : String(err)}`));
          }
          continue;
        }

        // Extract external sources
        const externalSources = await extractExternalSources(scrapeResult);

        const result = {
          item,
          scrapeKey,       // Pass the KV key — not the full scrapeResult — to stay within 128KB queue limit
          externalSources,
          isRelevant: true,
          relevanceReason: evaluation.reasoning,
        };

        // Cache the positive result
        await env.INGEST_STATE.put(cacheKey, JSON.stringify(result), {
          expirationTtl: 604800, // 7 days
        });

        // SurrealDB: mark evaluated (non-blocking)
        if (db) {
          db.updateArticle(item.url, {
            status: 'evaluated',
            relevanceScore: 1.0,
            evalModel: 'mistral',
          }).catch(err => console.warn(`[Stage 3] SurrealDB eval update failed: ${err instanceof Error ? err.message : String(err)}`));
        }

        evaluatedItems.push(result);
      }
      
      // Enqueue relevant items for upload
      if (evaluatedItems.length > 0) {
        const uploadMessage: UploadMessage = {
          type: 'batch',
          items: evaluatedItems,
          batchId: message.batchId,
          timestamp: Date.now(),
        };
        
        await env.UPLOAD_QUEUE.send(uploadMessage);
        console.log(`[Stage 3] Enqueued ${evaluatedItems.length} relevant items for upload`);
      }
      
    } catch (error) {
      console.error(`[Stage 3] Error processing batch ${message.batchId}:`, error);
      throw error;
    }
  }
}
