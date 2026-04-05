import { z } from "zod/v4";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { log } from "../logger.js";
import type { ArxivPaper } from "./types.js";

export interface FeedDefinition {
  name: string;
  sourceName: string;
  feedType: "newsletter" | "article" | "subreddit" | "tutorial" | "research";
  /**
   * For "rss" / "json" feeds: the feed endpoint URL.
   * For "scraped_page" feeds: the blog/news index page URL to crawl for article links.
   */
  feedUrl: string;
  /** "rss" for standard RSS, "json" for JSON feed (rss.app JSON format),
   *  "scraped_page" for sites without feeds — index page is scraped for links. */
  format: "rss" | "json" | "scraped_page";
  /** For JSON feeds fetched via HTTP */
  httpUrl?: string;
  /** For reddit feeds, the subreddit name */
  subreddit?: string;
  /**
   * For "scraped_page" feeds: URL path prefix used to filter article links.
   * e.g. "/news/" keeps only paths like "/news/some-article-slug".
   * If omitted, a generic depth-based heuristic is used.
   */
  articlePathPrefix?: string;
  /** Category for grouping */
  category: "newsletter" | "json" | "reddit" | "blog" | "news" | "substack" | "tutorial" | "research";
  /** Whether this feed is active */
  enabled: boolean;
  /** Reason for disabling (if applicable) */
  disabledReason?: string;
}

const FeedSchema = z.object({
  name: z.string(),
  sourceName: z.string(),
  feedType: z.enum(["newsletter", "article", "subreddit", "tutorial", "research"]),
  feedUrl: z.string().url(),
  format: z.enum(["rss", "json", "scraped_page"]),
  httpUrl: z.string().url().optional(),
  subreddit: z.string().optional(),
  articlePathPrefix: z.string().optional(),
  category: z.enum(["newsletter", "json", "reddit", "blog", "news", "substack", "tutorial", "research"]),
  enabled: z.boolean(),
  disabledReason: z.string().optional(),
});

const FeedsConfigSchema = z.object({
  feeds: z.array(FeedSchema),
  domainSourceMap: z.record(z.string(), z.string()),
});

function loadFeedsConfig(): z.infer<typeof FeedsConfigSchema> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const configPath = resolve(__dirname, "../../feeds.json");

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (err) {
    log.error("Failed to read feeds.json", {
      path: configPath,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error(`Cannot read feeds.json at ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.error("Failed to parse feeds.json", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error("feeds.json contains invalid JSON");
  }

  const result = FeedsConfigSchema.safeParse(parsed);
  if (!result.success) {
    log.error("feeds.json validation failed", { issues: result.error.issues });
    throw new Error(
      `feeds.json validation failed: ${result.error.issues.map((i) => i.message).join(", ")}`
    );
  }

  const enabledCount = result.data.feeds.filter((f) => f.enabled).length;
  log.info(`Loaded feeds.json: ${result.data.feeds.length} feeds (${enabledCount} enabled)`);

  return result.data;
}

const config = loadFeedsConfig();

const enabledFeeds = config.feeds.filter((f) => f.enabled) as FeedDefinition[];

// Scraped-page feeds are handled by a dedicated pipeline stage.
// They are intentionally excluded from the category-based feed arrays below
// so the standard RSS/JSON fetch functions don't try to parse them.
export const SCRAPED_PAGE_FEEDS: FeedDefinition[] = enabledFeeds.filter(
  (f) => f.format === "scraped_page"
);

// Helper: exclude scraped_page feeds from regular RSS/JSON processing
const standardFeeds = enabledFeeds.filter((f) => f.format !== "scraped_page");

export const NEWSLETTER_FEEDS: FeedDefinition[] = standardFeeds.filter(
  (f) => f.category === "newsletter"
);

export const JSON_FEEDS: FeedDefinition[] = standardFeeds.filter(
  (f) => f.category === "json"
);

export const REDDIT_FEEDS: FeedDefinition[] = standardFeeds.filter(
  (f) => f.category === "reddit"
);

export const BLOG_FEEDS: FeedDefinition[] = standardFeeds.filter(
  (f) => f.category === "blog"
);

export const NEWS_FEEDS: FeedDefinition[] = standardFeeds.filter(
  (f) => f.category === "news"
);

export const SUBSTACK_FEEDS: FeedDefinition[] = standardFeeds.filter(
  (f) => f.category === "substack"
);

export const TUTORIAL_FEEDS: FeedDefinition[] = standardFeeds.filter(
  (f) => f.category === "tutorial"
);

export const RESEARCH_FEEDS: FeedDefinition[] = standardFeeds.filter(
  (f) => f.category === "research"
);

export const ALL_FEEDS: FeedDefinition[] = enabledFeeds;

/** Domain-to-source mapping for Google News articles */
export const DOMAIN_SOURCE_MAP: Record<string, string> = config.domainSourceMap;

/**
 * Fetch recent AI research papers from arXiv
 * @param maxResults Maximum number of papers to fetch
 * @returns Array of ArxivPaper objects, or empty array on error
 */
export async function fetchArxivPapers(maxResults: number): Promise<ArxivPaper[]> {
  try {
    const url = `https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;
    
    const response = await fetch(url, {
      headers: { 'User-Agent': 'AI-Newsletter-Bot/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      log.error('arXiv API returned error', { status: response.status });
      return [];
    }

    const xml = await response.text();
    const papers = parseArxivXml(xml);
    
    // Filter to last 7 days
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentPapers = papers.filter(p => new Date(p.publishedDate) > oneWeekAgo);
    
    log.info(`arXiv: fetched ${recentPapers.length} papers from last 7 days`);
    return recentPapers;
  } catch (error) {
    log.error('Failed to fetch arXiv papers', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Parse arXiv Atom XML response into structured papers
 */
function parseArxivXml(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];
  
  // Extract entries using regex (lightweight for Workers)
  const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi);
  
  for (const entryMatch of entryMatches) {
    const entryXml = entryMatch[1];
    
    const title = extractTag(entryXml, 'title');
    const abstract = extractTag(entryXml, 'summary');
    const published = extractTag(entryXml, 'published');
    const urlMatch = entryXml.match(/<id>([^<]+)<\/id>/i);
    const url = urlMatch ? urlMatch[1] : '';
    
    // Extract authors
    const authors: string[] = [];
    const authorMatches = entryXml.matchAll(/<name>([^<]+)<\/name>/gi);
    for (const authorMatch of authorMatches) {
      authors.push(authorMatch[1]);
    }
    
    // Extract categories
    const categories: string[] = [];
    const categoryMatches = entryXml.matchAll(/<term\s+scheme="http:\/\/arxiv.org\/schemas\/atom">([^<]+)<\/term>/gi);
    for (const categoryMatch of categoryMatches) {
      categories.push(categoryMatch[1]);
    }
    
    if (title && url) {
      papers.push({
        title: title.trim(),
        abstract: abstract.trim(),
        authors,
        url,
        publishedDate: published || new Date().toISOString(),
        categories,
      });
    }
  }
  
  return papers;
}

/**
 * Extract content from XML tag
 */
function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'));
  return match ? match[1]?.trim() || '' : '';
}
