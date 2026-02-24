import { log } from "../logger.js";
import { config } from "../config.js";
import type { FirecrawlSearchResult } from "./search.js";

// ---------------------------------------------------------------------------
// Exa AI search — neural / hybrid web search optimised for AI content
// Docs: https://docs.exa.ai/reference/search
//
// We return FirecrawlSearchResult-compatible objects so discover.ts can use
// Exa and Firecrawl results interchangeably without any type gymnastics.
// ---------------------------------------------------------------------------

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ExaApiResult {
  id: string;
  url: string;
  title: string;
  score: number;
  publishedDate?: string;
  author?: string;
  text?: string;
  summary?: string;
}

interface ExaApiResponse {
  results: ExaApiResult[];
}

/**
 * Search the web via Exa AI and return results in the same shape as
 * FirecrawlSearchResult so they can be merged directly in discover.ts.
 *
 * Uses Exa's "auto" search type which picks between neural and keyword
 * search based on the query — best general-purpose setting.
 *
 * @param query  - Search query string
 * @param limit  - Max results to return (default 5)
 */
export async function exaSearch(
  query: string,
  limit = 5
): Promise<FirecrawlSearchResult[]> {
  // Resolve key: config (Node.js) or Worker globals
  const apiKey: string =
    config.exa.apiKey ||
    ((globalThis as Record<string, unknown>).EXA_API_KEY as string) ||
    "";

  if (!apiKey) {
    log.warn("[exa-search] EXA_API_KEY not configured — skipping Exa search");
    return [];
  }

  const body = {
    query,
    numResults: limit,
    // "auto" lets Exa choose neural vs keyword based on the query
    type: "auto",
    contents: {
      // Request truncated body text for relevance evaluation
      text: { maxCharacters: 3000 },
    },
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(EXA_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Exa uses x-api-key, not Bearer
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        log.warn("[exa-search] API error", {
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

      const data = (await response.json()) as ExaApiResponse;

      if (!data.results) {
        log.warn("[exa-search] Response missing results field", { attempt, query });
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
          // Use text body for relevance evaluation; fall back to summary
          markdown: r.text ?? r.summary ?? "",
          description: r.summary,
        }));

      log.info(`[exa-search] ${mapped.length} results for query: ${query}`);
      return mapped;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("[exa-search] Fetch error", { attempt, maxRetries: MAX_RETRIES, error: msg, query });
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }

  return [];
}
