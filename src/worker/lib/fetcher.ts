/**
 * Worker-compatible feed fetching
 * Fetches and parses RSS/JSON feeds without Node.js dependencies
 */

import { ALL_FEEDS, type FeedDefinition } from './feeds-bundler.js';
import { Logger } from './logger.js';

const log = new Logger('fetcher');

export interface NormalizedFeedItem {
  url: string;
  title: string;
  sourceName: string;
  feedType: string;
  feedUrl: string;
  uploadFileName: string;
  authors: string;
  publishedTimestamp: string;
  description?: string;
  content?: string;
}

export class FeedFetcher {
  constructor() {
    // Nothing to initialize - using lightweight parsing
  }

  /**
   * Fetch all enabled feeds
   * SAFETY: Each feed is wrapped in individual try/catch to prevent cascade failures
   */
  async fetchAllFeeds(): Promise<NormalizedFeedItem[]> {
    console.log('=== FETCHER: Starting feed fetch ===');
    console.log(`Total feeds in config: ${ALL_FEEDS.length}`);
    
    const enabledFeeds = ALL_FEEDS.filter(f => f.enabled);
    console.log(`Enabled feeds: ${enabledFeeds.length}`);
    
    // Separate feeds by type
    const rssFeeds = enabledFeeds.filter(f => f.format === 'rss');
    const jsonFeeds = enabledFeeds.filter(f => f.format === 'json');
    
    console.log(`RSS feeds: ${rssFeeds.length}`);
    console.log(`JSON feeds: ${jsonFeeds.length}`);

    // Process feeds sequentially to avoid resource limits
    console.log('Processing feeds sequentially (safety mode)...');
    const allItems: NormalizedFeedItem[] = [];
    
    // Process RSS feeds one by one
    for (const feed of rssFeeds) {
      try {
        console.log(`  → ${feed.name} (RSS)`);
        const items = await this.fetchSingleRssFeed(feed);
        allItems.push(...items);
        console.log(`    ✓ Got ${items.length} items (total: ${allItems.length})`);
      } catch (error) {
        console.error(`    ✗ Failed: ${error instanceof Error ? error.message : error}`);
      }
      // Small delay to avoid overwhelming the Worker
      await this.delay(100);
    }
    
    // Process JSON feeds one by one
    for (const feed of jsonFeeds) {
      try {
        console.log(`  → ${feed.name} (JSON)`);
        const items = await this.fetchSingleJsonFeed(feed);
        allItems.push(...items);
        console.log(`    ✓ Got ${items.length} items (total: ${allItems.length})`);
      } catch (error) {
        console.error(`    ✗ Failed: ${error instanceof Error ? error.message : error}`);
      }
      // Small delay to avoid overwhelming the Worker
      await this.delay(100);
    }

    console.log(`=== FETCHER: Completed with ${allItems.length} total items ===`);
    return allItems;
  }

  /**
   * Fetch a single RSS feed with maximum safety
   */
  private async fetchSingleRssFeed(feed: FeedDefinition): Promise<NormalizedFeedItem[]> {
    try {
      console.log(`    Fetching: ${feed.httpUrl || feed.feedUrl}`);
      const response = await fetch(feed.httpUrl || feed.feedUrl, {
        headers: { 'User-Agent': 'AI-Newsletter-Bot/1.0' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const xml = await response.text();
      
      // Safety: wrap parsing in try/catch
      let items: NormalizedFeedItem[];
      try {
        items = this.parseRSS(xml, feed);
      } catch (parseError) {
        console.error(`    Parse error (using empty array): ${parseError}`);
        items = [];
      }
      
      return items;
    } catch (error) {
      console.error(`    ✗ Feed fetch failed: ${feed.name} - ${error}`);
      return []; // Graceful degradation
    }
  }

  /**
   * Fetch a single JSON feed with maximum safety
   */
  private async fetchSingleJsonFeed(feed: FeedDefinition): Promise<NormalizedFeedItem[]> {
    try {
      if (!feed.httpUrl) {
        console.warn(`    ✗ No httpUrl for: ${feed.name}`);
        return [];
      }
      
      console.log(`    Fetching: ${feed.httpUrl}`);
      const response = await fetch(feed.httpUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      // Safety: wrap parsing in try/catch  
      let items: NormalizedFeedItem[];
      try {
        items = this.parseJsonFeed(data, feed);
      } catch (parseError) {
        console.error(`    Parse error (using empty array): ${parseError}`);
        items = [];
      }
      
      return items;
    } catch (error) {
      console.error(`    ✗ Feed fetch failed: ${feed.name} - ${error}`);
      return []; // Graceful degradation
    }
  }

  /**
   * Small delay to prevent Worker resource exhaustion
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fetch RSS feeds
   */
  private async fetchRssFeeds(feeds: FeedDefinition[]): Promise<NormalizedFeedItem[]> {
    if (feeds.length === 0) return [];

    const results = await Promise.allSettled(
      feeds.map(async (feed) => {
        try {
          log.info(`Fetching RSS: ${feed.name}`);
          const response = await fetch(feed.httpUrl || feed.feedUrl, {
            headers: {
              'User-Agent': 'AI-Newsletter-Bot/1.0'
            }
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const xml = await response.text();
          const items = await this.parseRSS(xml, feed);
          
          log.info(`✅ ${feed.name}: ${items.length} items`);
          return items;
        } catch (error) {
          log.error(`❌ Failed to fetch ${feed.name}`, { error });
          return [];
        }
      })
    );

    return results
      .filter((r): r is PromiseFulfilledResult<NormalizedFeedItem[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);
  }

  /**
   * Fetch JSON feeds (rss.app format)
   */
  private async fetchJsonFeeds(feeds: FeedDefinition[]): Promise<NormalizedFeedItem[]> {
    if (feeds.length === 0) return [];

    const results = await Promise.allSettled(
      feeds.map(async (feed) => {
        try {
          log.info(`Fetching JSON: ${feed.name}`);
          const response = await fetch(feed.httpUrl!);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();
          const items = this.parseJsonFeed(data, feed);
          
          log.info(`✅ ${feed.name}: ${items.length} items`);
          return items;
        } catch (error) {
          log.error(`❌ Failed to fetch ${feed.name}`, { error });
          return [];
        }
      })
    );

    return results
      .filter((r): r is PromiseFulfilledResult<NormalizedFeedItem[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);
  }

  /**
   * Parse RSS XML to normalized items
   */
  private parseRSS(xml: string, feed: FeedDefinition): NormalizedFeedItem[] {
    try {
      const items: NormalizedFeedItem[] = [];
      
      // Extract items using regex (lightweight for Workers)
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
      
      for (const itemMatch of itemMatches) {
        const itemXml = itemMatch[1];
        
        // Extract fields
        const title = this.extractTag(itemXml, 'title');
        const link = this.extractTag(itemXml, 'link');
        const pubDate = this.extractTag(itemXml, 'pubDate') || this.extractTag(itemXml, 'dc:date');
        const creator = this.extractTag(itemXml, 'dc:creator') || this.extractTag(itemXml, 'author');
        const description = this.extractTag(itemXml, 'description');

        if (title && link) {
          const normalizedItem: NormalizedFeedItem = {
            url: link,
            title: this.unescapeHtml(title),
            sourceName: feed.sourceName,
            feedType: feed.feedType,
            feedUrl: feed.feedUrl,
            uploadFileName: this.generateUploadFileName(link, feed.sourceName, pubDate),
            authors: creator || '',
            publishedTimestamp: pubDate || new Date().toISOString(),
            description: this.unescapeHtml(description || ''),
          };

          items.push(normalizedItem);
        }
      }

      return items;
    } catch (error) {
      log.error(`RSS parsing failed for ${feed.name}`, { error });
      return [];
    }
  }

  /**
   * Parse JSON feed (rss.app format)
   */
  private parseJsonFeed(data: any, feed: FeedDefinition): NormalizedFeedItem[] {
    try {
      if (!data.items || !Array.isArray(data.items)) {
        return [];
      }

      return data.items.map((item: any) => {
        const url = item.url || item.link || '';
        const title = item.title || '';
        const pubDate = item.pubDate || item.published || item.date_published || item.isoDate;
        const description = item.description || item.content || item.summary || '';
        const creator = item.creator?.name || item.creator || item.author || '';

        return {
          url,
          title: this.unescapeHtml(title),
          sourceName: feed.sourceName,
          feedType: feed.feedType,
          feedUrl: feed.feedUrl,
          uploadFileName: this.generateUploadFileName(url, feed.sourceName, pubDate),
          authors: creator instanceof Array ? creator.join(', ') : String(creator),
          publishedTimestamp: pubDate || new Date().toISOString(),
          description: this.unescapeHtml(description),
        };
      });
    } catch (error) {
      log.error(`JSON parsing failed for ${feed.name}`, { error });
      return [];
    }
  }

  /**
   * Extract content from XML tag
   */
  private extractTag(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'));
    if (!match) return '';
    
    // Also check for self-closing tags with attributes
    const selfClosingMatch = xml.match(new RegExp(`<${tag}[^>]*\\s+content="([^"]*)"`, 'i'));
    if (selfClosingMatch) return selfClosingMatch[1];
    
    return match[1]?.trim() || '';
  }

  /**
   * Generate upload filename (mimics original normalize.js)
   */
  private generateUploadFileName(url: string, sourceName: string, pubDate?: string): string {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname || '/';
      const slug = path
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      
      const date = pubDate ? new Date(pubDate).toISOString().split('T')[0] : 'no-date';
      
      return `${date}_${sourceName}_${slug || 'index'}`.substring(0, 200);
    } catch {
      return `${sourceName}_${Date.now()}`;
    }
  }

  /**
   * Unescape HTML entities
   */
  private unescapeHtml(text: string): string {
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&');
  }
}

// Export singleton
export const feedFetcher = new FeedFetcher();
