/**
 * Favicon API Fetcher for MCP servers
 * Fetches favicons from homepages using Google Favicon API
 */

import { LogoResult } from './logoResolver.js';

/**
 * Favicon API Fetcher
 */
export class FaviconFetcher {
  private timeout: number;

  constructor(timeout: number = 1000) {
    this.timeout = timeout;
  }

  /**
   * Generate favicon URL from homepage URL
   */
  generateFaviconUrl(homepageUrl: string): string | null {
    if (!homepageUrl) return null;
    try {
      const url = new URL(homepageUrl);
      const domain = url.hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
    } catch (error) {
      console.error('Invalid homepage URL:', homepageUrl);
      return null;
    }
  }

  /**
   * Fetch favicon URL for a server
   */
  async fetchFavicon(server: {
    fields?: { homepage_url?: string; github_url?: string };
  }): Promise<LogoResult> {
    // Get homepage URL
    const homepageUrl = server.fields?.homepage_url;
    if (!homepageUrl) {
      return { url: null, source: null, cachedAt: null };
    }

    // Generate favicon URL
    const faviconUrl = this.generateFaviconUrl(homepageUrl);
    if (!faviconUrl) {
      return { url: null, source: null, cachedAt: null };
    }

    return {
      url: faviconUrl,
      source: 'favicon',
      cachedAt: new Date().toISOString(),
    };
  }

  /**
   * Batch fetch favicons for multiple servers
   */
  async batchFetchFavicons(
    servers: { fields?: { homepage_url?: string; github_url?: string } }[]
  ): Promise<Map<string, LogoResult>> {
    const results = new Map<string, LogoResult>();
    const promises = servers.map(async (server) => {
      const result = await this.fetchFavicon(server);
      results.set(server.fields?.name || 'unknown', result);
    });
    await Promise.all(promises);
    return results;
  }
}
