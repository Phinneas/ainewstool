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
    scrapeResult: {
      content: string;
      mainContentImageUrls: string[];
      rawHtml: string;
      links: string[];
      metadata: {
        url: string;
        title: string;
      };
    };
  }>;
  batchId: string;
  timestamp: number;
}

export interface UploadMessage {
  type: 'batch';
  items: Array<{
    item: any;
    scrapeResult: {
      content: string;
      mainContentImageUrls: string[];
      rawHtml: string;
      links: string[];
      metadata: {
        url: string;
        title: string;
      };
    };
    externalSources: string;
    isRelevant: boolean;
    relevanceReason: string;
  }>;
  batchId: string;
  timestamp: number;
}
