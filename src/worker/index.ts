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
  Exa?: string;
  TAVILY_API_KEY?: string;
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

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    
    // Health check endpoint
    if (req.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
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
        console.error(`Unknown queue: ${batch.queue}`);
    }
  },
};
