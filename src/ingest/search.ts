import { config } from "../config.js";
import { log } from "../logger.js";
import { CategoryQuery, ShowHNResult, NormalizedItem } from "./types.js";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v1/search";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// How many days back to search for articles. Applies to Parallel Search after_date
// and the FindAll recently_launched condition.
const SEARCH_FRESHNESS_DAYS = 7;

// Hard deadline for the entire parallelFindAll job (create + poll + fetch).
// If the job hasn't completed by this point we bail and return whatever partial
// results are available rather than blocking discovery indefinitely.
const FINDALL_TIMEOUT_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FirecrawlSearchResult {
  url: string;
  title: string;
  markdown: string;
  description?: string;
}

export interface FirecrawlSearchResponse {
  success: boolean;
  data: FirecrawlSearchResult[];
}

export async function firecrawlSearch(
  query: string,
  limit = 5
): Promise<FirecrawlSearchResult[]> {
  const body = {
    query,
    limit,
    scrapeOptions: {
      formats: ["markdown"],
      onlyMainContent: true,
    },
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);

      const response = await fetch(FIRECRAWL_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.firecrawl.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        log.warn(`Firecrawl search error`, {
          attempt,
          maxRetries: MAX_RETRIES,
          status: response.status,
          error: errorText,
          query,
        });
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return [];
      }

      const data = (await response.json()) as FirecrawlSearchResponse;

      if (!data.success || !data.data) {
        log.warn(`Firecrawl search unsuccessful`, { attempt, query });
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return [];
      }

      log.info(`Firecrawl search returned ${data.data.length} results`, { query });
      return data.data;
    } catch (err) {
      log.warn(`Firecrawl search fetch error`, {
        attempt,
        maxRetries: MAX_RETRIES,
        error: err instanceof Error ? err.message : String(err),
        query,
      });
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }

  return [];
}

/**
 * Fetch Show HN posts from HackerNews Algolia API
 * @param query Search query
 * @param maxResults Maximum number of results
 * @returns Array of ShowHNResult objects
 */
export async function fetchShowHN(query: string, maxResults: number): Promise<ShowHNResult[]> {
  try {
    const yesterday = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=show_hn,story&hitsPerPage=${maxResults}&numericFilters=created_at_i>${yesterday}`;
    
    const response = await fetch(url, {
      headers: { 'User-Agent': 'AI-Newsletter-Bot/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      log.error('HackerNews API returned error', { status: response.status });
      return [];
    }

    const data = await response.json();
    
    // Filter to minimum 3 points and normalize
    const results: ShowHNResult[] = (data.hits || []).filter((h: any) => h.points >= 3).map((h: any) => ({
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      points: h.points,
      commentUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
      author: h.author,
      createdAt: h.created_at,
    }));
    
    log.info(`HackerNews: fetched ${results.length} Show HN posts`);
    return results;
  } catch (error) {
    log.error('Failed to fetch HackerNews Show HN', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

const PARALLEL_BASE = "https://api.parallel.ai";

function parallelHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": config.parallel.apiKey,
    ...extra,
  };
}

/**
 * Parallel Search — replaces Exa for research and policy categories.
 * Single POST call, synchronous response.
 */
export async function parallelSearch(
  queries: string[],
  category: string,
  limit = 5
): Promise<NormalizedItem[]> {
  if (!config.parallel?.apiKey) {
    log.warn("Parallel API key not configured, skipping parallel-search");
    return [];
  }

  try {
    // Get freshness cutoff date for recency filter
    const afterDate = new Date(Date.now() - SEARCH_FRESHNESS_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const response = await fetch(`${PARALLEL_BASE}/v1beta/search`, {
      method: "POST",
      headers: parallelHeaders(),
      body: JSON.stringify({
        search_queries: queries,
        max_results: limit,
        source_policy: { after_date: afterDate },
        excerpts: { max_chars_per_result: 2000, max_chars_total: 10000 },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const err = await response.text();
      log.error("Parallel Search error", { status: response.status, error: err, category });
      return [];
    }

    const data = (await response.json()) as {
      results: Array<{
        url: string;
        title: string | null;
        publish_date: string | null;
        excerpts: string[];
      }>;
    };

    return (data.results ?? []).map((r) => ({
      title: r.title ?? r.url,
      url: r.url,
      summary: r.excerpts.join("\n\n"),
      source: category,
      publishedDate: r.publish_date ?? new Date().toISOString(),
      contentType: category === "research" ? "research" : "news",
    } satisfies NormalizedItem));
  } catch (error) {
    log.error("Parallel Search fetch error", {
      error: error instanceof Error ? error.message : String(error),
      category,
    });
    return [];
  }
}

/**
 * Parallel FindAll — replaces Tavily for startup/indie category.
 * Async job: create run → poll until complete → fetch results.
 * Rate limited to 300 POST/hour — only called once per cron run.
 */
export async function parallelFindAll(
  objective: string,
  matchLimit = 20
): Promise<NormalizedItem[]> {
  if (!config.parallel?.apiKey) {
    log.warn("Parallel API key not configured, skipping parallel-findall");
    return [];
  }

  const findallHeaders = parallelHeaders({ "parallel-beta": "findall-2025-09-15" });

  try {
    const deadline = Date.now() + FINDALL_TIMEOUT_MS;

    // Step 1: Create the run
    const createRes = await fetch(`${PARALLEL_BASE}/v1beta/findall/runs`, {
      method: "POST",
      headers: findallHeaders,
      body: JSON.stringify({
        objective,
        entity_type: "AI tool, project, or startup",
        match_conditions: [
          {
            name: "indie_or_small_team",
            description:
              "Built or launched by an indie developer, small team, or startup " +
              "— NOT a product from OpenAI, Google, Meta, Microsoft, Amazon, Apple, or Anthropic",
          },
          {
            name: "ai_focused",
            description: "The product or project is primarily AI-powered or AI-related",
          },
          {
            name: "recently_launched",
            description: `Launched, released, or announced within the last ${SEARCH_FRESHNESS_DAYS} days`,
          },
        ],
        generator: "base",
        match_limit: matchLimit,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      log.error("Parallel FindAll create error", { status: createRes.status, error: err });
      return [];
    }

    const { findall_id } = (await createRes.json()) as { findall_id: string };
    log.info("Parallel FindAll run created", { findall_id, timeoutMs: FINDALL_TIMEOUT_MS });

    // Step 2: Poll until complete or deadline exceeded (every 5s)
    let completed = false;
    let poll = 0;

    while (Date.now() + 5_000 < deadline) {
      await new Promise((r) => setTimeout(r, 5_000));
      poll++;

      const statusRes = await fetch(
        `${PARALLEL_BASE}/v1beta/findall/runs/${findall_id}`,
        { headers: findallHeaders, signal: AbortSignal.timeout(10_000) }
      );

      if (!statusRes.ok) continue;

      const statusData = (await statusRes.json()) as {
        status?: { status: string; metrics?: { matched_candidates_count: number } };
      };

      const runStatus = statusData.status?.status;
      log.info("Parallel FindAll poll", {
        findall_id,
        poll,
        status: runStatus,
        matched: statusData.status?.metrics?.matched_candidates_count ?? 0,
        msRemaining: deadline - Date.now(),
      });

      if (runStatus === "completed") {
        completed = true;
        break;
      }
    }

    if (!completed) {
      log.warn("Parallel FindAll deadline exceeded, fetching partial results", {
        findall_id,
        polls: poll,
        timeoutMs: FINDALL_TIMEOUT_MS,
      });
    }

    // Step 3: Fetch results
    const resultRes = await fetch(
      `${PARALLEL_BASE}/v1beta/findall/runs/${findall_id}/result`,
      { headers: findallHeaders, signal: AbortSignal.timeout(15_000) }
    );

    if (!resultRes.ok) {
      log.error("Parallel FindAll result fetch error", { status: resultRes.status });
      return [];
    }

    const resultData = (await resultRes.json()) as {
      candidates: Array<{
        name: string;
        url: string;
        description: string;
        match_status: string;
      }>;
    };

    const matched = (resultData.candidates ?? []).filter(
      (c) => c.match_status === "matched"
    );

    log.info(`Parallel FindAll returned ${matched.length} matched candidates`);

    return matched.map((c) => ({
      title: c.name,
      url: c.url,
      summary: c.description,
      source: "startup",
      publishedDate: new Date().toISOString(),
      contentType: "project",
    } satisfies NormalizedItem));
  } catch (error) {
    log.error("Parallel FindAll error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Route CategoryQuery to appropriate search engine.
 * All engine groups run concurrently via Promise.all — FindAll's 90s poll
 * no longer blocks Parallel Search or Tavily.
 */
export async function routeCategoryQueries(queries: CategoryQuery[]): Promise<NormalizedItem[]> {
  const parallelSearchCategories = queries.filter((q) => q.engine === "parallel-search");
  const parallelFindAllCategories = queries.filter((q) => q.engine === "parallel-findall");
  const tavilyCategories = queries.filter((q) => q.engine === "tavily");
  const exaCategories = queries.filter((q) => q.engine === "exa");

  const findAllObjective =
    `Find AI tools, projects, and startups launched in the last ${SEARCH_FRESHNESS_DAYS} days by indie developers ` +
    "or small teams — exclude products from OpenAI, Google, Meta, Microsoft, Amazon, Apple, Anthropic";

  // Run all engine groups concurrently
  const [searchResults, findAllResults, tavilyResults, exaResults] = await Promise.all([
    // Parallel Search: one batched call per category
    Promise.all(
      parallelSearchCategories.map((q) => parallelSearch(q.queries, q.category, 8))
    ).then((r) => r.flat()),

    // Parallel FindAll: one job per category (polls up to 90s internally)
    Promise.all(
      parallelFindAllCategories.map(() => parallelFindAll(findAllObjective, 20))
    ).then((r) => r.flat()),

    // Tavily: per-query
    config.tavily?.apiKey
      ? Promise.all(
          tavilyCategories.flatMap((q) =>
            q.queries.map(async (query) => {
              const results = await tavilySearch(query, 5);
              return results.map((r) => ({
                title: r.title,
                url: r.url,
                summary: r.markdown,
                source: q.category,
                publishedDate: new Date().toISOString(),
                contentType: "news" as const,
              }));
            })
          )
        ).then((r) => r.flat())
      : Promise.resolve([]),

    // Exa: per-query fallback
    config.exa?.apiKey
      ? Promise.all(
          exaCategories.flatMap((q) =>
            q.queries.map(async (query) => {
              const results = await exaSearch(query, 5);
              return results.map((r) => ({
                title: r.title,
                url: r.url,
                summary: r.markdown,
                source: q.category,
                publishedDate: new Date().toISOString(),
                contentType: "news" as const,
              }));
            })
          )
        ).then((r) => r.flat())
      : Promise.resolve([]),
  ]);

  return [...searchResults, ...findAllResults, ...tavilyResults, ...exaResults];
}

/**
 * Exa search wrapper
 */
export async function exaSearch(query: string, limit: number): Promise<FirecrawlSearchResult[]> {
  if (!config.exa?.apiKey) {
    log.warn('Exa API key not configured');
    return [];
  }
  
  try {
    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.exa.apiKey,
      },
      body: JSON.stringify({
        query,
        numResults: limit,
        type: "auto",
        contents: { text: { maxCharacters: 3000 } },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      log.error('Exa search error', { status: response.status });
      return [];
    }

    const data = await response.json();
    return (data.results || []).map((r: any) => ({
      url: r.url,
      title: r.title,
      markdown: r.text || '',
      description: r.description,
    }));
  } catch (error) {
    log.error('Exa search fetch error', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Tavily search wrapper
 */
export async function tavilySearch(query: string, limit: number): Promise<FirecrawlSearchResult[]> {
  if (!config.tavily?.apiKey) {
    log.warn('Tavily API key not configured');
    return [];
  }
  
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: config.tavily.apiKey,
        query,
        max_results: limit,
        search_depth: "advanced",
        include_answer: false,
        include_images: false,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      log.error('Tavily search error', { status: response.status });
      return [];
    }

    const data = await response.json();
    return (data.results || []).map((r: any) => ({
      url: r.url,
      title: r.title,
      markdown: r.content || '',
      description: r.description,
    }));
  } catch (error) {
    log.error('Tavily search fetch error', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}
