/**
 * Open Graph Image Fetcher for MCP servers
 * Extracts OG images from homepages
 */

import { LogoResult } from './logoResolver.js';

/**
 * OG Image Fetcher
 */
export class OGImageFetcher {
  private timeout: number;

  constructor(timeout: number = 1000) {
    this.timeout = timeout;
  }

  /**
   * Extract Open Graph image from homepage URL
   */
  async extractOpenGraphImage(homepageUrl: string): Promise<string | null> {
    if (!homepageUrl) return null;
    try {
      const response = await fetch(homepageUrl, {
        headers: { 'User-Agent': 'BrainScriblr-Newsletter/1.0' },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        return null;
      }

      const html = await response.text();

      // Parse OG image meta tag
      const ogImageMatch = html.match(
        /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i
      );
      if (ogImageMatch && ogImageMatch[1]) {
        let imageUrl = ogImageMatch[1];
        if (imageUrl.startsWith('/')) {
          const baseUrl = new URL(homepageUrl);
          return `${baseUrl.origin}${imageUrl}`;
        }
        return imageUrl;
      }

      // Fallback: Twitter image
      const twitterImageMatch = html.match(
        /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i
      );
      if (twitterImageMatch && twitterImageMatch[1]) {
        let imageUrl = twitterImageMatch[1];
        if (imageUrl.startsWith('/')) {
          const baseUrl = new URL(homepageUrl);
          return `${baseUrl.origin}${imageUrl}`;
        }
        return imageUrl;
      }

      return null;
    } catch (error) {
      console.error('Failed to extract OG image:', error);
      return null;
    }
  }

  /**
   * Fetch OG image URL for a server
   */
  async fetchOGImage(server: {
    fields?: { homepage_url?: string; github_url?: string };
  }): Promise<LogoResult> {
    // Get homepage URL
    const homepageUrl = server.fields?.homepage_url;
    if (!homepageUrl) {
      return { url: null, source: null, cachedAt: null };
    }

    // Extract OG image
    const ogImageUrl = await this.extractOpenGraphImage(homepageUrl);
    if (!ogImageUrl) {
      return { url: null, source: null, cachedAt: null };
    }

    return {
      url: ogImageUrl,
      source: 'og-image',
      cachedAt: new Date().toISOString(),
    };
  }

  /**
   * Batch fetch OG images for multiple servers
   */
  async batchFetchOGImages(
    servers: { fields?: { homepage_url?: string; github_url?: string } }[]
  ): Promise<Map<string, LogoResult>> {
    const results = new Map<string, LogoResult>();
    const promises = servers.map(async (server) => {
      const result = await this.fetchOGImage(server);
      results.set(server.fields?.name || 'unknown', result);
    });
    await Promise.all(promises);
    return results;
  }
}
