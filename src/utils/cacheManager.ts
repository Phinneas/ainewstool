/**
 * Cache Manager for logo system
 * Uses Cloudflare KV for caching fetched logos
 */

import { LogoMetadata } from './logoResolver.js';

const CACHE_PREFIX = 'logo:';
const TTL_DEFAULT = 86400; // 24 hours

/**
 * Cache Manager class
 */
export class CacheManager {
  private namespace: KVNamespace;
  private defaultTtl: number;

  constructor(namespace: KVNamespace, defaultTtl: number = TTL_DEFAULT) {
    this.namespace = namespace;
    this.defaultTtl = defaultTtl;
  }

  /**
   * Get cached logo by server ID
   */
  async get(serverId: string): Promise<LogoMetadata | null> {
    try {
      const cached = await this.namespace.get(`${CACHE_PREFIX}${serverId}`);
      if (!cached) {
        return null;
      }

      const metadata = JSON.parse(cached) as LogoMetadata;
      
      // Check if expired
      if (this.isExpired(metadata)) {
        return null;
      }

      return metadata;
    } catch (error) {
      console.error(`Cache read error for ${serverId}:`, error);
      return null;
    }
  }

  /**
   * Store logo in cache
   */
  async set(serverId: string, metadata: LogoMetadata): Promise<void> {
    try {
      const ttl = this.calculateTtl(metadata.source);
      await this.namespace.put(
        `${CACHE_PREFIX}${serverId}`,
        JSON.stringify(metadata),
        { expirationTtl: ttl }
      );
    } catch (error) {
      console.error(`Cache write error for ${serverId}:`, error);
    }
  }

  /**
   * Invalidate cache entry for server
   */
  async invalidate(serverId: string): Promise<void> {
    try {
      await this.namespace.delete(`${CACHE_PREFIX}${serverId}`);
    } catch (error) {
      console.error(`Cache invalidation error for ${serverId}:`, error);
    }
  }

  /**
   * Check if metadata is expired
   */
  private isExpired(metadata: LogoMetadata): boolean {
    const expiresAt = new Date(metadata.expiresAt).getTime();
    return Date.now() > expiresAt;
  }

  /**
   * Calculate TTL based on source
   */
  private calculateTtl(source: string | null): number {
    const sourceTtls: Record<string, number> = {
      github: 21600, // 6 hours
      favicon: 86400, // 24 hours
      'og-image': 604800, // 7 days
      'repo-custom': 604800, // 7 days
    };
    return sourceTtls[source || ''] || this.defaultTtl;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    total: number;
    hits: number;
    misses: number;
    expired: number;
  }> {
    // This is a simplified version - in practice, you'd track stats separately
    return {
      total: 0,
      hits: 0,
      misses: 0,
      expired: 0,
    };
  }
}
