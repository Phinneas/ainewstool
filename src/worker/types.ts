/**
 * Shared types for Worker handlers
 */

export interface ScrapeMessage {
  type: 'batch';
  items: Array<{
    url: string;
    title: string;
    sourceName: string;
    feedType: string;
    feedUrl: string;
    uploadFileName: string;
    authors: string;
    publishedTimestamp: string;
  }>;
  batchId: string;
  timestamp: number;
}

export interface EvaluateMessage {
  type: 'batch';
  items: Array<{
    item: any; // NormalizedFeedItem will be imported from original code
    scrapeKey: string; // KV key for the scrape result — avoids 128KB queue payload limit
  }>;
  batchId: string;
  timestamp: number;
}

export interface UploadMessage {
  type: 'batch';
  items: Array<{
    item: any;
    scrapeKey: string; // KV key for the scrape result — avoids 128KB queue payload limit
    externalSources: string;
    isRelevant: boolean;
    relevanceReason: string;
  }>;
  batchId: string;
  timestamp: number;
}
