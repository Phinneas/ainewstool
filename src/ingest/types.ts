/**
 * Type definitions for the ingest module
 */

export type ContentType = 'news' | 'research' | 'project';
export type SearchEngine = 'exa' | 'tavily';
export type QueryCategory = 'research' | 'startup' | 'enterprise' | 'policy' | 'consumer';

export interface CategoryQuery {
  category: QueryCategory;
  engine: SearchEngine;
  queries: string[];
}

export interface ArxivPaper {
  title: string;
  abstract: string;
  authors: string[];
  url: string;
  publishedDate: string;
  categories: string[];
}

export interface NormalizedItem {
  title: string;
  url: string;
  summary: string;
  source: string;
  publishedDate: string;
  contentType: ContentType;
  score?: number;
}

export interface ShowHNResult {
  title: string;
  url: string;
  points: number;
  commentUrl: string;
  author: string;
  createdAt: string;
}
