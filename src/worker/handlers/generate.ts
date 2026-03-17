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
import { Logger, PipelineMetrics } from '../lib/logger.js';

interface GenerateMessage {
  type: 'generate';
  generateId: string;
  dates: string[];
  timestamp: number;
}

export async function handleGenerateQueue(
  batch: MessageBatch<GenerateMessage>,
  env: Env
): Promise<void> {
  const log = new Logger('stage-5');
  log.info('generate batch received', { messages: batch.messages.length });

  for (const msg of batch.messages) {
    const message = msg.body;
    const genLog = log.withContext(message.generateId);
    const metrics = new PipelineMetrics(env.INGEST_STATE, message.generateId, 'metrics:generate');

    genLog.info('generate started', {
      generate_id: message.generateId,
      date_range: `${message.dates[message.dates.length - 1]} to ${message.dates[0]}`,
    });

    try {
      const dedupKey = `generated:${message.generateId}`;
      const alreadyDone = await env.INGEST_STATE.get(dedupKey);
      if (alreadyDone) {
        genLog.info('already generated — skipping', { generate_id: message.generateId });
        continue;
      }

      apiKeys.anthropic = env.ANTHROPIC_API_KEY;
      apiKeys.mistral = env.MISTRAL_API_KEY;
      apiKeys.moonshot = env.MOONSHOT_API_KEY;
      apiKeys.ideogram = env.IDEOGRAM_API_KEY ?? '';
      if (env.Exa) process.env.EXA_API_KEY = env.Exa;
      if (env.TAVILY_API_KEY) process.env.TAVILY_API_KEY = env.TAVILY_API_KEY;

      const previousNewsletter = await env.INGEST_STATE.get('newsletter:previous') ?? undefined;

      const usedKeysList = await env.INGEST_STATE.list({ prefix: 'newsletter:used-keys:' });
      const usedKeySets = await Promise.all(
        usedKeysList.keys.map(k => env.INGEST_STATE.get(k.name))
      );
      const usedArticleKeys = new Set<string>(
        usedKeySets
          .filter((v): v is string => v !== null)
          .flatMap(v => { try { return JSON.parse(v) as string[]; } catch { return []; } })
      );
      genLog.info('hard-dedup loaded', { previously_used_keys: usedArticleKeys.size });

      await metrics.set('started_at', Date.now());
      await metrics.set('generate_id', message.generateId);

      const timer = genLog.timer('newsletter generation');
      const { newsletter, usedIdentifiers } = await generateNewsletter(
        message.dates,
        env.CONTENT_BUCKET,
        previousNewsletter,
        usedArticleKeys
      );
      timer.end();

      genLog.info('newsletter generated', {
        length: newsletter.length,
        articles_used: usedIdentifiers.length,
      });

      await metrics.set('newsletter_length', newsletter.length);
      await metrics.set('articles_used', usedIdentifiers.length);

      await env.INGEST_STATE.put(dedupKey, JSON.stringify({
        timestamp: Date.now(),
        length: newsletter.length,
      }), { expirationTtl: 60 * 60 * 24 * 14 });

      await env.INGEST_STATE.put('newsletter:previous', newsletter, {
        expirationTtl: 60 * 60 * 24 * 14,
      });

      await env.INGEST_STATE.put(
        `newsletter:used-keys:${message.generateId}`,
        JSON.stringify(usedIdentifiers),
        { expirationTtl: 60 * 60 * 24 * 30 }
      );

      await env.PUBLISH_QUEUE.send({
        type: 'publish',
        generateId: message.generateId,
        newsletter,
        dates: message.dates,
        timestamp: Date.now(),
      });

      genLog.info('enqueued for publishing');

    } catch (error) {
      genLog.error('generation failed', {
        generate_id: message.generateId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      await env.INGEST_STATE.put(
        `error:generate:${message.generateId}`,
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: Date.now(),
        }),
        { expirationTtl: 60 * 60 * 24 * 7 }
      );

      throw error;
    }
  }
}
