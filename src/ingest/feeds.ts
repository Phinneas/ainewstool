import { z } from "zod/v4";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { log } from "../logger.js";

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
