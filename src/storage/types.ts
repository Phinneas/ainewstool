export interface ContentMetadata {
  key: string;
  type: string; // "newsletter" | "article" | "subreddit"
  title: string;
  authors: string;
  "source-name": string;
  "external-source-urls": string;
  "image-urls": string;
  url: string;
  timestamp: string;
  "feed-url": string;
}

export interface ContentItem {
  key: string;
  content: string;
  metadata: ContentMetadata;
}

export interface NormalizedFeedItem {
  title: string;
  url: string;
  authors: string;
  publishedTimestamp: string;
  sourceName: string;
  feedType: string;
  feedUrl: string;
  uploadFileName: string;
}

export interface ScrapeResult {
  content: string;
  mainContentImageUrls: string[];
  rawHtml: string;
  links: string[];
  metadata: { url: string; title: string };
}
