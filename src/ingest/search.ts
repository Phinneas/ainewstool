import { config } from "../config.js";
import { log } from "../logger.js";
import { CategoryQuery, ShowHNResult, NormalizedItem } from "./types.js";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v1/search";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

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

/**
 * Route CategoryQuery to appropriate search engine
 * @param queries Array of CategoryQuery objects
 * @returns Array of normalized search results
 */
export async function routeCategoryQueries(queries: CategoryQuery[]): Promise<NormalizedItem[]> {
  const allResults: NormalizedItem[] = [];
  
  for (const categoryQuery of queries) {
    for (const query of categoryQuery.queries) {
      let results: FirecrawlSearchResult[] = [];
      
      if (categoryQuery.engine === 'exa') {
        // Use Exa search (configured in config.ts)
        if (config.exa?.apiKey) {
          results = await exaSearch(query, 5);
        }
      } else if (categoryQuery.engine === 'tavily') {
        // Use Tavily search (configured in config.ts)
        if (config.tavily?.apiKey) {
          results = await tavilySearch(query, 5);
        }
      }
      
      // Convert to NormalizedItem
      for (const result of results) {
        allResults.push({
          title: result.title,
          url: result.url,
          summary: result.markdown,
          source: categoryQuery.category,
          publishedDate: new Date().toISOString(),
          contentType: 'news',
        });
      }
    }
  }
  
  return allResults;
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
