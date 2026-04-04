# Technical Design

## Architecture Overview
All changes are additive. No existing functions are removed. New functions are composed into the existing `runDiscovery()` call in `discover.ts`.

## Type Definitions
Add to `src/ingest/types.ts` (create if not exists):

```typescript
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
```

## Module Changes

### `src/ingest/generate-queries.ts`
- REMOVE: `generateQueries()` (or keep as deprecated fallback)
- ADD: `generateCategoryQueries(): CategoryQuery[]`
- Query banks: 5-7 queries per category, hardcoded strings
- Startup queries MUST include: `-OpenAI -Google -Meta -Microsoft -Amazon -Apple` 
  exclusion logic passed to search layer

### `src/ingest/search.ts`
- ADD: `fetchShowHN(query: string, maxResults: number): Promise<ShowHNResult[]>`
- UPDATE: route CategoryQuery objects to correct engine (exa vs tavily)
- Endpoint: `https://hn.algolia.com/api/v1/search`
- Params: `tags=show_hn,story`, `numericFilters=created_at_i>[unix_yesterday]`, 
  `hitsPerPage=maxResults`

### `src/ingest/feeds.ts`
- ADD: `fetchArxivPapers(maxResults: number): Promise<ArxivPaper[]>`
- Endpoint: `https://export.arxiv.org/api/query`
- Params: `search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL`
- `sortBy=submittedDate&sortOrder=descending`
- Parse Atom XML using native `DOMParser` (available in CF Workers)
- Date filter: reject papers older than 7 days

### `src/ingest/evaluate.ts`
- ADD: `detectContentType(item: NormalizedItem): ContentType`
  - Heuristics: URL contains `arxiv.org` | `semanticscholar` | `paperswithcode` → `research`
  - URL contains `github.com` | `show HN` | `huggingface.co/spaces` → `project`
  - Default → `news`
- ADD: separate LLM prompt constant `RESEARCH_SCORING_PROMPT` (see below)
- UPDATE: `evaluateItem()` to branch on contentType
- ADD: post-scoring guarantee: if no research item scores above threshold, 
  force-include the highest-scoring research item anyway

### `src/ingest/discover.ts`
- UPDATE: `runDiscovery()` to call `fetchArxivPapers()` and `fetchShowHN()`
- Merge results with existing RSS + Exa/Tavily results before evaluation step
- Pass contentType through to evaluate step

### `check-feeds.ts` (project root, not in src/)
- Standalone script, no Worker dependencies
- Read `feeds.json`, fetch each URL with `fetch()`, report status table
- Run with: `npx ts-node check-feeds.ts`

## LLM Prompts

### `RESEARCH_SCORING_PROMPT`
```
You are evaluating an AI research paper for a technically curious but non-academic 
newsletter audience.

Score this paper from 1-10 on:
- Accessibility: Can the key insight be explained in 2 sentences to a developer? (40%)
- Novelty: Does it represent a genuinely new approach or result? (35%)  
- Relevance: Does it have practical implications for AI practitioners? (25%)

Return JSON: { "score": number, "headline": string, "tldr": string }
The headline should read like a newsletter headline, not an academic title.
The tldr should be 1-2 sentences a developer would find interesting.
```