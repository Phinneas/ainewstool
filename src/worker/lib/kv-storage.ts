/**
 * KV-based storage adapter for Workers
 * Replaces S3 for metadata tracking and deduplication
 */

import { Env } from '../index.js';

export class KVStorage {
  constructor(private env: Env) {}
  
  /**
   * Check if an item exists (for deduplication)
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.env.INGEST_STATE.get(`item:${key}`);
    return result !== null;
  }
  
  /**
   * Mark an item as processed
   */
  async markProcessed(key: string, metadata: Record<string, any>): Promise<void> {
    await this.env.INGEST_STATE.put(
      `item:${key}`,
      JSON.stringify({
        timestamp: Date.now(),
        ...metadata,
      })
    );
  }
  
  /**
   * Get processing status for an item
   */
  async getStatus(key: string): Promise<{ processed: boolean; timestamp?: number }> {
    const result = await this.env.INGEST_STATE.get(`item:${key}`);
    if (!result) {
      return { processed: false };
    }
    const data = JSON.parse(result);
    return { processed: true, timestamp: data.timestamp };
  }
  
  /**
   * Get ingestion statistics
   */
  async getStats(prefix: string = ''): Promise<{
    total: number;
    processed: number;
    failed: number;
  }> {
    // List keys with prefix
    const list = await this.env.INGEST_STATE.list({ prefix });
    const keys = list.keys;
    
    // This is a simplified version - in practice, you'd paginate
    return {
      total: keys.length,
      processed: keys.filter((k: any) => !k.name.startsWith('failed:')).length,
      failed: keys.filter((k: any) => k.name.startsWith('failed:')).length,
    };
  }
}
