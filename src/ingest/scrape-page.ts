import { log } from "../logger.js";
import { buildUploadFileName } from "./normalize.js";
import type { FeedDefinition } from "./feeds.js";
import type { NormalizedFeedItem } from "../storage/types.js";

// ---------------------------------------------------------------------------
// Multi-tier index-page link scraper
// 1. Native fetch + HTML link extraction (free)
// 2. Firecrawl links-only scrape (paid, fallback)
// ---------------------------------------------------------------------------

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Multi-tier index page link extraction:
 * 1. Native fetch + HTML link extraction (free, primary)
 * 2. Firecrawl links-only scrape (paid, fallback for edge cases)
 */
async function fetchIndexPageLinks(
  indexUrl: string,
  apiKey: string
): Promise<string[]> {
  // Tier 1: Try native fetch first (free)
  const nativeLinks = await tryNativeFetchLinks(indexUrl);
  if (nativeLinks.length > 0) {
    log.info("[scrape-page] Native fetch succeeded", {
      url: indexUrl,
      linkCount: nativeLinks.length,
    });
    return nativeLinks;
  }

  log.warn("[scrape-page] Native fetch failed or returned no links, trying Firecrawl fallback", {
    url: indexUrl,
  });

  // Tier 2: Firecrawl fallback (paid)
  return await fetchFirecrawlLinks(indexUrl, apiKey);
}

/**
 * Native fetch + HTML link extraction (free).
 * Works in both Node.js and Cloudflare Workers.
 */
async function tryNativeFetchLinks(indexUrl: string): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(indexUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AI-Newsletter-Bot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      log.debug("[scrape-page] Native fetch HTTP error", {
        status: response.status,
        url: indexUrl,
      });
      return [];
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      log.debug("[scrape-page] Native fetch non-HTML content", { contentType, url: indexUrl });
      return [];
    }

    const html = await response.text();

    if (!html || html.length < 500) {
      log.debug("[scrape-page] Native fetch returned empty/short HTML", {
        length: html?.length ?? 0,
        url: indexUrl,
      });
      return [];
    }

    // Extract links from HTML
    const links = extractLinksFromHtml(html);
    return links;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.debug("[scrape-page] Native fetch error", { error: errorMsg, url: indexUrl });
    return [];
  }
}

/**
 * Extract links from HTML.
 */
function extractLinksFromHtml(html: string): string[] {
  const urls: string[] = [];
  const linkRegex = /<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    urls.push(match[1]);
  }

  return urls.slice(0, 50); // Limit to 50 links for index pages
}

/**
 * Firecrawl links-only scrape (paid, fallback for edge cases).
 * Used when native fetch fails (JavaScript-rendered pages, blocked sites).
 */
async function fetchFirecrawlLinks(
  indexUrl: string,
  apiKey: string
): Promise<string[]> {
  const body = {
    url: indexUrl,
    formats: ["links"],
    // Do NOT set onlyMainContent — index pages often list articles outside the
    // "main content" region (e.g. in a grid/card layout Firecrawl may miss).
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      const response = await fetch(FIRECRAWL_SCRAPE_URL, {
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
        log.warn("[scrape-page] Firecrawl fallback failed", {
          attempt,
          status: response.status,
          url: indexUrl,
          error: errText,
        });
        if (attempt < 2) {
          await sleep(3000);
          continue;
        }
        return [];
      }

      const data = (await response.json()) as {
        success: boolean;
        data?: { links?: string[] };
      };

      log.info("[scrape-page] Firecrawl fallback succeeded", {
        url: indexUrl,
        linkCount: data.data?.links?.length ?? 0,
      });

      return data.data?.links ?? [];
    } catch (err) {
      log.warn("[scrape-page] Firecrawl fallback fetch error", {
        attempt,
        url: indexUrl,
        error: err instanceof Error ? err.message : String(err),
      });
      if (attempt < 2) await sleep(3000);
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Link filtering
// ---------------------------------------------------------------------------

/**
 * Filters a raw list of links from an index page down to article-only URLs.
 *
 * Strategy:
 *  1. Must be same hostname as the index URL.
 *  2. If `articlePathPrefix` is provided, URL must start with that prefix and
 *     have at least one additional path segment (the slug).
 *  3. Without a prefix: must be deeper than the index page path and not
 *     look like a pagination/category/tag URL.
 */
function extractArticleLinks(
  indexUrl: string,
  links: string[],
  articlePathPrefix?: string
): string[] {
  let originHostname: string;
  let indexPath: string;

  try {
    const parsed = new URL(indexUrl);
    originHostname = parsed.hostname;
    indexPath = parsed.pathname.replace(/\/$/, ""); // strip trailing slash
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const articles: string[] = [];

  for (const link of links) {
    let linkUrl: URL;
    try {
      // Resolve relative links against the index URL
      linkUrl = new URL(link, indexUrl);
    } catch {
      continue;
    }

    // Must be same hostname
    if (linkUrl.hostname !== originHostname) continue;

    // Normalise: strip hash & query string for comparison
    const canonical = `${linkUrl.origin}${linkUrl.pathname}`.replace(/\/$/, "");
    if (seen.has(canonical)) continue;

    const path = linkUrl.pathname.replace(/\/$/, "");

    if (articlePathPrefix) {
      // Prefix-based filtering (most precise)
      if (!path.startsWith(articlePathPrefix)) continue;
      const afterPrefix = path.slice(articlePathPrefix.length).replace(/^\//, "");
      // Must have a non-empty slug-like segment with no further sub-paths
      if (!afterPrefix) continue;
      // Allow one level deep only (e.g. /news/some-article, not /news/cat/article)
      if (afterPrefix.includes("/")) continue;
      // Reject obvious non-article paths
      if (/^(page|tag|category|author|archive|feed|rss|search|sitemap)/.test(afterPrefix)) continue;
    } else {
      // Generic fallback: must be a direct child of the index path
      if (!path.startsWith(indexPath + "/")) continue;
      const afterIndex = path.slice(indexPath.length + 1);
      if (!afterIndex) continue;
      if (afterIndex.includes("/")) continue; // skip sub-directories
      // Reject non-article path patterns
      if (/^(page|tag|category|author|archive|feed|rss|search|sitemap)/.test(afterIndex)) continue;
    }

    seen.add(canonical);
    articles.push(canonical);
  }

  return articles;
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

/**
 * Normalizes a discovered article URL into a NormalizedFeedItem.
 *
 * Since index pages don't expose publish dates, we use today's timestamp.
 * The real article title is discovered later during stageScrape (via
 * scrapeResult.metadata.title) and surfaced in the upload metadata.
 *
 * The upload filename uses the URL slug so it is stable across runs —
 * the S3 existence check in stageFilter provides deduplication.
 */
export function normalizeScrapedPageItem(
  articleUrl: string,
  feed: FeedDefinition
): NormalizedFeedItem {
  const isoDate = new Date().toISOString();

  // Derive a human-readable slug from the URL path
  const slug =
    articleUrl
      .split("/")
      .filter(Boolean)
      .pop() ?? "article";

  // Readable title placeholder — will be overridden in upload metadata by
  // the actual page title from scrapeResult.metadata.title
  const titleFromSlug = slug.replace(/-/g, " ");

  return {
    title: titleFromSlug,
    url: articleUrl,
    authors: "",
    publishedTimestamp: isoDate,
    sourceName: feed.sourceName,
    feedType: feed.feedType,
    feedUrl: feed.feedUrl,
    // Use slug (not titleFromSlug) so the S3 key is stable + concise
    uploadFileName: buildUploadFileName(isoDate, slug, feed.sourceName),
  };
}

// ---------------------------------------------------------------------------
// Main export: fetch all items for a scraped_page feed
// ---------------------------------------------------------------------------

/**
 * Scrapes a blog index page to discover article links, then returns them
 * as NormalizedFeedItem[] ready for the standard ingest pipeline stages:
 *   stageFilter → stageScrape → stageEvaluate → stageUpload
 *
 * Uses native fetch first (free), falls back to Firecrawl for edge cases.
 */
export async function fetchScrapedPageFeedItems(
  feed: FeedDefinition
): Promise<NormalizedFeedItem[]> {
  const indexUrl = feed.feedUrl; // re-purposed: stores the blog index page URL

  // Resolve Firecrawl API key for fallback (Node.js env or Cloudflare Worker globals)
  const apiKey: string =
    process.env?.FIRECRAWL_API_KEY ??
    (globalThis as Record<string, unknown>).FIRECRAWL_API_KEY as string ?? "";

  // Note: apiKey is optional - native fetch will work without it
  // Firecrawl fallback only used when native fetch fails

  log.info(`[scrape-page] Fetching index page for ${feed.name}: ${indexUrl}`);

  const links = await fetchIndexPageLinks(indexUrl, apiKey);

  if (links.length === 0) {
    log.warn(`[scrape-page] No links returned for ${feed.name}`, { indexUrl });
    return [];
  }

  log.info(`[scrape-page] Raw links from index page: ${links.length}`, { feed: feed.name });

  const articleLinks = extractArticleLinks(indexUrl, links, feed.articlePathPrefix);

  log.info(`[scrape-page] Article links after filtering: ${articleLinks.length}`, {
    feed: feed.name,
    prefix: feed.articlePathPrefix ?? "(generic)",
  });

  const items = articleLinks.map((url) => normalizeScrapedPageItem(url, feed));
  return items;
}
