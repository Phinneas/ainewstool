/**
 * Type definitions for Cloudflare Workers
 * These are re-exported from @cloudflare/workers-types
 */

// Re-export the types we need for cleaner imports
export type { 
  Queue, 
  MessageBatch, 
  R2Bucket, 
  KVNamespace, 
  ExecutionContext, 
  ScheduledEvent 
} from '@cloudflare/workers-types';
