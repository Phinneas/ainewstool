/**
 * Bundles feeds.json into the Worker at build time
 * Workers don't have file system access, so we need to embed the data
 */

// @ts-ignore - this will be resolved by the bundler
import feedsData from '../../../feeds.json';

export interface FeedDefinition {
  name: string;
  sourceName: string;
  feedType: 'newsletter' | 'article' | 'subreddit' | 'tutorial' | 'research';
  feedUrl: string;
  format: 'rss' | 'json';
  httpUrl?: string;
  subreddit?: string;
  category: 'newsletter' | 'json' | 'reddit' | 'blog' | 'news' | 'substack' | 'tutorial' | 'research';
  enabled: boolean;
  disabledReason?: string;
}

export interface FeedsConfig {
  feeds: FeedDefinition[];
  domainSourceMap: Record<string, string>;
}

// Bundle feeds.json at build time
export const FEEDS_CONFIG = feedsData as FeedsConfig;

export const ENABLED_FEEDS: FeedDefinition[] = FEEDS_CONFIG.feeds.filter((f) => f.enabled);

export const NEWSLETTER_FEEDS: FeedDefinition[] = ENABLED_FEEDS.filter(
  (f) => f.category === 'newsletter'
);

export const JSON_FEEDS: FeedDefinition[] = ENABLED_FEEDS.filter(
  (f) => f.category === 'json'
);

export const REDDIT_FEEDS: FeedDefinition[] = ENABLED_FEEDS.filter(
  (f) => f.category === 'reddit'
);

export const BLOG_FEEDS: FeedDefinition[] = ENABLED_FEEDS.filter(
  (f) => f.category === 'blog'
);

export const NEWS_FEEDS: FeedDefinition[] = ENABLED_FEEDS.filter(
  (f) => f.category === 'news'
);

export const SUBSTACK_FEEDS: FeedDefinition[] = ENABLED_FEEDS.filter(
  (f) => f.category === 'substack'
);

export const TUTORIAL_FEEDS: FeedDefinition[] = ENABLED_FEEDS.filter(
  (f) => f.category === 'tutorial'
);

export const RESEARCH_FEEDS: FeedDefinition[] = ENABLED_FEEDS.filter(
  (f) => f.category === 'research'
);

export const ALL_FEEDS: FeedDefinition[] = ENABLED_FEEDS;

export const DOMAIN_SOURCE_MAP: Record<string, string> = FEEDS_CONFIG.domainSourceMap;
