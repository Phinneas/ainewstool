/**
 * Stage 5: Generate newsletter from accumulated R2 content
 * Consumes messages from generate-queue, enqueues to publish-queue
 *
 * Reads content for the last N days from R2, runs the full LLM generation
 * pipeline (select stories → write sections → write intro → write shortlist
 * → assemble), then enqueues the result for Ghost publishing.
 */

import { Env } from '../index.js';
import { generateNewsletter } from '../../generate/index.js';
import { apiKeys } from '../../llm/api-keys.js';

interface GenerateMessage {
  type: 'generate';
  generateId: string;
  dates: string[]; // YYYY-MM-DD strings, newest first
  timestamp: number;
}

export async function handleGenerateQueue(
  batch: MessageBatch<GenerateMessage>,
  env: Env
): Promise<void> {
  console.log(`[Stage 5] Processing generate batch with ${batch.messages.length} message(s)`);

  for (const msg of batch.messages) {
    const message = msg.body;
    console.log(`[Stage 5] Generate ID: ${message.generateId}`);
    console.log(`[Stage 5] Date range: ${message.dates[message.dates.length - 1]} to ${message.dates[0]}`);

    try {
      // Check if already generated (avoid duplicate runs)
      const dedupKey = `generated:${message.generateId}`;
      const alreadyDone = await env.INGEST_STATE.get(dedupKey);
      if (alreadyDone) {
        console.log(`[Stage 5] Already generated: ${message.generateId} — skipping`);
        continue;
      }

      // Set global API keys so generate pipeline can call LLM APIs
      // (Workers don't reliably support process.env across modules)
      apiKeys.anthropic = env.ANTHROPIC_API_KEY;
      apiKeys.mistral = env.MISTRAL_API_KEY;
      apiKeys.moonshot = env.MOONSHOT_API_KEY;
      
      console.log('[Stage 5] API keys set - Anthropic:', apiKeys.anthropic ? `${apiKeys.anthropic.substring(0,10)}...` : 'EMPTY');
      console.log('[Stage 5] API keys set - Mistral:', apiKeys.mistral ? `${apiKeys.mistral.substring(0,10)}...` : 'EMPTY');
      if (env.Exa) process.env.EXA_API_KEY = env.Exa;
      if (env.TAVILY_API_KEY) process.env.TAVILY_API_KEY = env.TAVILY_API_KEY;

      // Fetch previous newsletter from KV for deduplication guidance
      const previousNewsletter = await env.INGEST_STATE.get('newsletter:previous') ?? undefined;

      // Run the full generation pipeline
      console.log('[Stage 5] Starting newsletter generation...');
      const newsletter = await generateNewsletter(
        message.dates,
        env.CONTENT_BUCKET,
        previousNewsletter
      );

      console.log(`[Stage 5] Newsletter generated (${newsletter.length} chars)`);

      // Mark as generated
      await env.INGEST_STATE.put(dedupKey, JSON.stringify({
        timestamp: Date.now(),
        length: newsletter.length,
      }), { expirationTtl: 60 * 60 * 24 * 14 }); // 14 days

      // Store as previous newsletter for next run's dedup
      await env.INGEST_STATE.put('newsletter:previous', newsletter, {
        expirationTtl: 60 * 60 * 24 * 14,
      });

      // Enqueue for Ghost publishing
      await env.PUBLISH_QUEUE.send({
        type: 'publish',
        generateId: message.generateId,
        newsletter,
        dates: message.dates,
        timestamp: Date.now(),
      });

      console.log('[Stage 5] Enqueued for Ghost publishing');

    } catch (error) {
      console.error(`[Stage 5] Generation failed for ${message.generateId}:`, error);

      await env.INGEST_STATE.put(
        `error:generate:${message.generateId}`,
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: Date.now(),
        }),
        { expirationTtl: 60 * 60 * 24 * 7 }
      );

      throw error; // Let queue retry
    }
  }
}
