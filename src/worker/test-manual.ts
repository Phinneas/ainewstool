/**
 * Manual test script for the Worker pipeline
 * Runs locally using wrangler dev
 */

import { handleScheduled } from './handlers/scheduled.js';
import type { Env } from './index.js';

// Mock environment for local testing
const mockEnv: Env = {
  SCRAPE_QUEUE: {
    send: async (message: any) => {
      console.log('📤 Mock: Sending to scrape-queue', JSON.stringify(message).substring(0, 200));
    },
    sendBatch: async (messages: any[]) => {
      console.log(`📤 Mock: Sending batch of ${messages.length} to scrape-queue`);
    },
  } as any,
  
  EVALUATE_QUEUE: {
    send: async (message: any) => {
      console.log('📤 Mock: Sending to evaluate-queue', JSON.stringify(message).substring(0, 200));
    },
    sendBatch: async (messages: any[]) => {
      console.log(`📤 Mock: Sending batch of ${messages.length} to evaluate-queue`);
    },
  } as any,
  
  UPLOAD_QUEUE: {
    send: async (message: any) => {
      console.log('📤 Mock: Sending to upload-queue', JSON.stringify(message).substring(0, 200));
    },
    sendBatch: async (messages: any[]) => {
      console.log(`📤 Mock: Sending batch of ${messages.length} to upload-queue`);
    },
  } as any,
  
  CONTENT_BUCKET: {
    put: async (key: string, value: string | ArrayBuffer | ReadableStream, options?: any) => {
      console.log(`💾 Mock: Uploading to R2 - ${key} (${typeof value})`);
      return { key, httpEtag: 'mock-etag' } as any;
    },
    get: async (key: string) => {
      console.log(`📥 Mock: Getting from R2 - ${key}`);
      return null;
    },
    delete: async (key: string) => {
      console.log(`🗑️  Mock: Deleting from R2 - ${key}`);
    },
    list: async (options?: any) => {
      console.log(`📋 Mock: Listing R2 objects`);
      return { objects: [] } as any;
    },
  } as any,
  
  INGEST_STATE: {
    get: async (key: string) => {
      console.log(`📋 Mock: KV get - ${key}`);
      return null;
    },
    put: async (key: string, value: string, options?: any) => {
      console.log(`💾 Mock: KV put - ${key}`);
    },
    delete: async (key: string) => {
      console.log(`🗑️  Mock: KV delete - ${key}`);
    },
    list: async (options?: any) => {
      console.log(`📋 Mock: KV list`);
      return { keys: [], list_complete: true } as any;
    },
  } as any,
  
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY || '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY || '',
  MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY || '',
  REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
};

async function main() {
  console.log('🧪 Testing Worker pipeline locally...\n');
  
  try {
    console.log('⏰ Starting Stage 1: Feed fetching...\n');
    await handleScheduled(mockEnv);
    
    console.log('\n✅ Test completed successfully!');
    console.log('The pipeline would have:');
    console.log('1. ✅ Fetched feeds');
    console.log('2. ✅ Enqueued items for scraping');
    console.log('3. ✅ Queues would process in the background');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { mockEnv };
