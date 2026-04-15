/// <reference path="./globals.d.ts" />

/**
 * Main Worker entry point
 * Handles scheduled triggers and routes to appropriate handlers
 */

import { handleScheduled, handleGenerateCron } from './handlers/scheduled.js';
import { handleScrapeQueue } from './handlers/scrape.js';
import { handleEvaluateQueue } from './handlers/evaluate.js';
import { handleUploadQueue } from './handlers/upload.js';
import { handleGenerateQueue } from './handlers/generate.js';
import { handlePublishQueue } from './handlers/publish.js';
import { Logger } from './lib/logger.js';

export interface Env {
  // Queues
  SCRAPE_QUEUE: Queue<any>;
  EVALUATE_QUEUE: Queue<any>;
  UPLOAD_QUEUE: Queue<any>;
  GENERATE_QUEUE: Queue<any>;
  PUBLISH_QUEUE: Queue<any>;

  // Storage
  CONTENT_BUCKET: R2Bucket;
  INGEST_STATE: KVNamespace;

  // Secrets
  FIRECRAWL_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  MISTRAL_API_KEY: string;
  MOONSHOT_API_KEY: string;
  EXA_API_KEY?: string;
  TAVILY_API_KEY?: string;
  PARALLEL_API_KEY?: string;
  PARALLEL_MONITOR_RESEARCH_ID?: string;
  PARALLEL_MONITOR_STARTUP_ID?: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  GHOST_ADMIN_API_KEY: string;
  GHOST_API_URL: string;
  BEEHIIV_API_KEY?: string;
  BEEHIIV_PUBLICATION_ID?: string;
  IDEOGRAM_API_KEY?: string;

  // SurrealDB
  SURREALDB_URL?: string;
  SURREALDB_NS?: string;
  SURREALDB_DB?: string;
  SURREALDB_USER?: string;
  SURREALDB_PASS?: string;
}

/** Read up to `limit` KV keys with a given prefix and return parsed JSON values. */
async function listKvByPrefix<T>(
  kv: KVNamespace,
  prefix: string,
  limit = 10
): Promise<T[]> {
  const listed = await kv.list({ prefix, limit });
  const values = await Promise.all(
    listed.keys.map(k => kv.get<T>(k.name, 'json'))
  );
  return values.filter((v): v is T => v !== null);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const log = new Logger('worker:fetch');

    // Health check endpoint
    if (req.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Pipeline status endpoint — returns per-run metrics and recent errors
    if (req.method === 'GET' && url.pathname === '/status') {
      try {
        const [ingestRuns, generateRuns, recentErrors, dbFailures] = await Promise.all([
          listKvByPrefix(env.INGEST_STATE, 'metrics:run:', 10),
          listKvByPrefix(env.INGEST_STATE, 'metrics:generate:', 5),
          listKvByPrefix(env.INGEST_STATE, 'error:', 10),
          listKvByPrefix(env.INGEST_STATE, 'db-fail:', 20),
        ]);

        // Most recent newsletter publish info
        const ghostList = await env.INGEST_STATE.list({ prefix: 'published:ghost:', limit: 3 });
        const recentPublished = await Promise.all(
          ghostList.keys.map(k => env.INGEST_STATE.get(k.name, 'json'))
        );

        const status = {
          generated_at: new Date().toISOString(),
          ingest_runs: ingestRuns,
          generate_runs: generateRuns,
          recent_errors: recentErrors,
          recent_published: recentPublished.filter(Boolean),
          db_failures: dbFailures, // SurrealDB write failures tracked here
        };

        return new Response(JSON.stringify(status, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        log.error('status endpoint error', { error: err instanceof Error ? err.message : String(err) });
        return new Response(JSON.stringify({ error: 'Failed to load status' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Manual trigger endpoint
    if (req.method === 'POST' && url.pathname === '/trigger') {
      ctx.waitUntil(handleScheduled(env));
      return new Response(JSON.stringify({ message: 'Ingestion triggered' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Manual generate endpoint
    if (req.method === 'POST' && url.pathname === '/generate') {
      ctx.waitUntil(handleGenerateCron(env));
      return new Response(JSON.stringify({ message: 'Newsletter generation triggered' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron;
    // Generate crons: Wednesday and Saturday at 8am UTC
    const isGenerateCron = cron === '0 8 * * 3' || cron === '0 8 * * 6';
    if (isGenerateCron) {
      ctx.waitUntil(handleGenerateCron(env));
    } else {
      ctx.waitUntil(handleScheduled(env));
    }
  },

  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    // Route to appropriate handler based on queue name
    switch (batch.queue) {
      case 'scrape-queue':
        await handleScrapeQueue(batch, env);
        break;
      case 'evaluate-queue':
        await handleEvaluateQueue(batch, env);
        break;
      case 'upload-queue':
        await handleUploadQueue(batch, env);
        break;
      case 'generate-queue':
        await handleGenerateQueue(batch, env);
        break;
      case 'publish-queue':
        await handlePublishQueue(batch, env);
        break;
      default:
        new Logger('worker:queue').error('unknown queue', { queue: batch.queue });
    }
  },
};
