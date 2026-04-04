# Requirements Document

Perfect use case for a Kiro spec - you already have the format in your `.kiro/specs/` folder. The trick to forcing actual implementation rather than hand-waving is: **atomic tasks with exact file paths, function signatures pre-defined, and acceptance criteria that require running code**.

Here are the three files to create as `.kiro/specs/newsletter-discovery-upgrade/`:

---

### `requirements.md`

```markdown
# Newsletter Discovery Upgrade

## Background
The ainewsletter pipeline uses generic mixed queries in `generate-queries.ts` that 
produce big-tech-dominated results. Research journal content is ingested via RSS 
but never surfaces in the final output. ~35% of Cloudflare Worker cron runs are 
failing. Small indie AI projects are invisible in the current output.

## Requirements

### REQ-1: Category-Based Query Generation
**User story:** As a newsletter editor, I want search queries to be category-specific 
so that each section of the newsletter (research, startup, enterprise, policy) pulls 
from targeted queries rather than a generic mixed batch.

**Acceptance criteria:**
- AC-1.1: `generate-queries.ts` exports a `generateCategoryQueries()` function that 
  returns queries grouped by category
- AC-1.2: Categories are: `research | startup | enterprise | policy | consumer`
- AC-1.3: Each category specifies its preferred search engine (`exa` | `tavily`)
- AC-1.4: Startup/indie queries explicitly exclude known big-tech brand names
- AC-1.5: Research queries use academic-oriented language targeting papers and 
  preprints

### REQ-2: Direct arXiv Integration
**User story:** As a newsletter editor, I want recent AI research papers from arXiv 
to appear in every issue under a "From the Lab" section, without depending on rss.app 
proxies.

**Acceptance criteria:**
- AC-2.1: `feeds.ts` exports a `fetchArxivPapers(maxResults: number)` function
- AC-2.2: Papers are fetched directly from the arXiv Atom API (no rss.app, no SDK)
- AC-2.3: Returns structured objects with: title, abstract, authors, url, publishedDate
- AC-2.4: Only papers from `cs.AI`, `cs.LG`, `cs.CL` categories are returned
- AC-2.5: Papers from the last 7 days only

### REQ-3: Research-Aware Content Scoring
**User story:** As a newsletter editor, I want research papers to be scored on 
"reader accessibility" rather than "newsworthiness" so they are not systematically 
deprioritized by the evaluation step.

**Acceptance criteria:**
- AC-3.1: `evaluate.ts` detects content type (`news` | `research` | `project`)
- AC-3.2: Research items use a separate LLM prompt focused on technical interest 
  and explainability
- AC-3.3: The final output preserves at least 1 research item per run regardless 
  of score

### REQ-4: HackerNews Show HN Discovery
**User story:** As a newsletter editor, I want Show HN posts to be included in 
discovery so that indie and small-team AI projects surface before they hit mainstream 
tech press.

**Acceptance criteria:**
- AC-4.1: `search.ts` exports a `fetchShowHN(query: string, maxResults: number)` 
  function
- AC-4.2: Uses the free HN Algolia API at `hn.algolia.com` - no API key, no SDK
- AC-4.3: Filters to `show_hn` tag only, last 24 hours, minimum 3 points
- AC-4.4: Results are normalized to the same shape as Exa/Tavily results

### REQ-5: RSS Feed Health Check
**User story:** As a developer, I want to know which rss.app feed IDs are returning 
errors so I can identify and replace broken research/niche feeds.

**Acceptance criteria:**
- AC-5.1: `check-feeds.ts` script (runnable via `npx ts-node`) tests each feed URL 
  in `feeds.json`
- AC-5.2: Reports: feed URL, HTTP status, item count, most recent item date
- AC-5.3: Flags feeds with 0 items or last item older than 14 days as STALE
- AC-5.4: Output is a readable table in the terminal
```

---

### `design.md`

```markdown
# Technical Design

## Architecture Overview
All changes are additive. No existing functions are removed. New functions are 
composed into the existing `runDiscovery()` call in `discover.ts`.

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
```

---

### `tasks.md`

```markdown
# Implementation Tasks

Complete tasks in order. Each task is a single, verifiable code change.
Do not mark a task complete without writing the actual code.

---

## Phase 1: Type Foundation
- [ ] **TASK-1** Create `src/ingest/types.ts` with all interfaces from design.md: 
  `ContentType`, `SearchEngine`, `QueryCategory`, `CategoryQuery`, `ArxivPaper`, 
  `NormalizedItem`, `ShowHNResult`

---

## Phase 2: New Data Sources

- [ ] **TASK-2** In `src/ingest/feeds.ts`, add function `fetchArxivPapers(maxResults: 
  number): Promise<ArxivPaper[]>` that fetches from 
  `https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL&sortBy=submittedDate&sortOrder=descending&max_results={maxResults}`, 
  parses the Atom XML response using DOMParser, filters to last 7 days, and returns 
  structured `ArxivPaper[]`. Handle fetch errors by returning `[]` not throwing.

- [ ] **TASK-3** In `src/ingest/search.ts`, add function `fetchShowHN(query: string, 
  maxResults: number): Promise<ShowHNResult[]>` that calls 
  `https://hn.algolia.com/api/v1/search?query={query}&tags=show_hn,story&hitsPerPage={maxResults}&numericFilters=created_at_i>{yesterdayUnix}`, 
  filters results to minimum 3 points, and returns `ShowHNResult[]`. 
  Handle fetch errors by returning `[]` not throwing.

---

## Phase 3: Category Query System

- [ ] **TASK-4** In `src/ingest/generate-queries.ts`, add the following query banks 
  as constants:
  - `RESEARCH_QUERIES`: 6 queries targeting preprints, benchmarks, model evals 
    (routed to Exa)
  - `STARTUP_QUERIES`: 6 queries with explicit big-tech exclusions for indie/small 
    team launches (routed to Tavily)
  - `ENTERPRISE_QUERIES`: 5 queries for enterprise AI adoption news (routed to Tavily)
  - `POLICY_QUERIES`: 5 queries for AI regulation and governance (routed to Exa)
  - `CONSUMER_QUERIES`: 5 queries for consumer-facing AI products (routed to Tavily)

- [ ] **TASK-5** In `src/ingest/generate-queries.ts`, add function 
  `generateCategoryQueries(): CategoryQuery[]` that returns one `CategoryQuery` 
  object per category using the banks from TASK-4. Export it.

- [ ] **TASK-6** In `src/ingest/search.ts`, update the main search orchestration 
  function to accept `CategoryQuery[]` input and route each category to its 
  specified engine. Startup queries must pass exclusion terms to the engine's 
  exclude parameter.

---

## Phase 4: Research-Aware Scoring

- [ ] **TASK-7** In `src/ingest/evaluate.ts`, add function `detectContentType(item: 
  NormalizedItem): ContentType` using URL-based heuristics: `arxiv.org` → 
  `research`, `github.com` + `show_hn` + `huggingface.co/spaces` + 
  `paperswithcode.com` → `project`, else → `news`.

- [ ] **TASK-8** In `src/ingest/evaluate.ts`, add the `RESEARCH_SCORING_PROMPT` 
  constant exactly as specified in design.md.

- [ ] **TASK-9** In `src/ingest/evaluate.ts`, update the item evaluation function to 
  branch: if `contentType === 'research'` use `RESEARCH_SCORING_PROMPT` and the 
  Mistral client (faster/cheaper for this task); else use the existing news prompt.

- [ ] **TASK-10** In `src/ingest/evaluate.ts`, after all items are scored, add a 
  guarantee: if zero research items are in the top-N selected items, force-insert 
  the highest-scoring research item into the selection, bumping the lowest-scoring 
  news item.

---

## Phase 5: Wire It Together

- [ ] **TASK-11** In `src/ingest/discover.ts`, inside `runDiscovery()`:
  1. Call `fetchArxivPapers(10)` and `fetchShowHN('AI tool', 15)` in parallel 
     with `Promise.all()`
  2. Convert arXiv results to `NormalizedItem[]` with `contentType: 'research'`
  3. Convert ShowHN results to `NormalizedItem[]` with `contentType: 'project'`
  4. Merge all results before the evaluate step
  5. Pass `contentType` through to `evaluate.ts`

- [ ] **TASK-12** Replace the `generateQueries()` call in `discover.ts` with 
  `generateCategoryQueries()` and update the search call to use the new 
  category-routed search from TASK-6.

---

## Phase 6: Feed Health Utility

- [ ] **TASK-13** Create `check-feeds.ts` in the project root. It must:
  1. Import and read `feeds.json`
  2. For each feed: fetch the URL, record HTTP status, parse JSON, count items, 
     find most recent item date
  3. Print a table: `feedUrl | status | itemCount | mostRecentDate | health`
  4. Mark STALE if: status !== 200, OR itemCount === 0, OR mostRecentDate > 14 
     days ago
  5. Print a summary count of healthy vs stale feeds at the end
  Runnable via `npx ts-node check-feeds.ts` with no Worker dependencies.

---

## Verification Checklist
Before marking this spec complete:
- [ ] `npx ts-node check-feeds.ts` runs and prints a table without errors
- [ ] `wrangler dev` starts without TypeScript errors
- [ ] A test run logs at least 1 arXiv paper and 1 ShowHN item in the discovery output
- [ ] A test run produces a selection that includes at least 1 research item
- [ ] The generated newsletter has a story from a company other than the 
  top-5 big tech names
```