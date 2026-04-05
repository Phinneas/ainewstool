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

- [~] **TASK-4** In `src/ingest/generate-queries.ts`, add the following query banks 
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