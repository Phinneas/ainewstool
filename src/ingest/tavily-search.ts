import { log } from "../logger.js";
import type { FirecrawlSearchResult } from "./search.js";

// ---------------------------------------------------------------------------
// Tavily AI search — designed for AI agents, returns structured snippets
// Docs: https://docs.tavily.com/docs/rest-api/api-reference
//
// We return FirecrawlSearchResult-compatible objects so ai-for-good.ts and
// ai-discoveries.ts can use Tavily and Exa results interchangeably.
// ---------------------------------------------------------------------------

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TavilyResult {
  url: string;
  title: string;
  content: string;
  score: number;
  published_date?: string;
}

interface TavilyApiResponse {
  results: TavilyResult[];
}

export interface TavilySearchOptions {
  /** ISO 8601 date string (YYYY-MM-DD). Only return results published on or after this date. */
  startPublishedDate?: string;
  /** ISO 8601 date string (YYYY-MM-DD). Only return results published on or before this date. */
  endPublishedDate?: string;
}

/**
 * Search the web via Tavily and return results in the same shape as
 * FirecrawlSearchResult so they can be used in ai-for-good.ts and
 * ai-discoveries.ts without changes to those modules' logic.
 *
 * @param query   - Search query string
 * @param limit   - Max results to return (default 5)
 * @param options - Optional filters: startPublishedDate, endPublishedDate
 */
export async function tavilySearch(
  query: string,
  limit = 5,
  options: TavilySearchOptions = {}
): Promise<FirecrawlSearchResult[]> {
  const apiKey: string =
    process.env.TAVILY_API_KEY ||
    ((globalThis as Record<string, unknown>).TAVILY_API_KEY as string) ||
    "";

  if (!apiKey) {
    log.warn("[tavily-search] TAVILY_API_KEY not configured — skipping Tavily search");
    return [];
  }

  const body: Record<string, unknown> = {
    query,
    max_results: limit,
    search_depth: "basic",
    include_answer: false,
    include_raw_content: false,
  };

  // Tavily supports start_date / end_date for publication filtering
  if (options.startPublishedDate) {
    body.start_date = options.startPublishedDate;
  }
  if (options.endPublishedDate) {
    body.end_date = options.endPublishedDate;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        log.warn("[tavily-search] API error", {
          attempt,
          maxRetries: MAX_RETRIES,
          status: response.status,
          error: errText,
          query,
        });
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return [];
      }

      const data = (await response.json()) as TavilyApiResponse;

      if (!data.results) {
        log.warn("[tavily-search] Response missing results field", { attempt, query });
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return [];
      }

      // Map to FirecrawlSearchResult shape
      const mapped: FirecrawlSearchResult[] = data.results
        .filter((r) => r.url && r.title)
        .map((r) => ({
          url: r.url,
          title: r.title || "Untitled",
          markdown: r.content ?? "",
          description: r.content,
        }));

      log.info(`[tavily-search] ${mapped.length} results for query: ${query}`);
      return mapped;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("[tavily-search] Fetch error", { attempt, maxRetries: MAX_RETRIES, error: msg, query });
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }

  return [];
}
