import { z } from "zod/v4";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { log } from "../logger.js";
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
function loadFeedsConfig() {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const configPath = resolve(__dirname, "../../feeds.json");
    let raw;
    try {
        raw = readFileSync(configPath, "utf-8");
    }
    catch (err) {
        log.error("Failed to read feeds.json", {
            path: configPath,
            error: err instanceof Error ? err.message : String(err),
        });
        throw new Error(`Cannot read feeds.json at ${configPath}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        log.error("Failed to parse feeds.json", {
            error: err instanceof Error ? err.message : String(err),
        });
        throw new Error("feeds.json contains invalid JSON");
    }
    const result = FeedsConfigSchema.safeParse(parsed);
    if (!result.success) {
        log.error("feeds.json validation failed", { issues: result.error.issues });
        throw new Error(`feeds.json validation failed: ${result.error.issues.map((i) => i.message).join(", ")}`);
    }
    const enabledCount = result.data.feeds.filter((f) => f.enabled).length;
    log.info(`Loaded feeds.json: ${result.data.feeds.length} feeds (${enabledCount} enabled)`);
    return result.data;
}
const config = loadFeedsConfig();
const enabledFeeds = config.feeds.filter((f) => f.enabled);
// Scraped-page feeds are handled by a dedicated pipeline stage.
// They are intentionally excluded from the category-based feed arrays below
// so the standard RSS/JSON fetch functions don't try to parse them.
export const SCRAPED_PAGE_FEEDS = enabledFeeds.filter((f) => f.format === "scraped_page");
// Helper: exclude scraped_page feeds from regular RSS/JSON processing
const standardFeeds = enabledFeeds.filter((f) => f.format !== "scraped_page");
export const NEWSLETTER_FEEDS = standardFeeds.filter((f) => f.category === "newsletter");
export const JSON_FEEDS = standardFeeds.filter((f) => f.category === "json");
export const REDDIT_FEEDS = standardFeeds.filter((f) => f.category === "reddit");
export const BLOG_FEEDS = standardFeeds.filter((f) => f.category === "blog");
export const NEWS_FEEDS = standardFeeds.filter((f) => f.category === "news");
export const SUBSTACK_FEEDS = standardFeeds.filter((f) => f.category === "substack");
export const TUTORIAL_FEEDS = standardFeeds.filter((f) => f.category === "tutorial");
export const RESEARCH_FEEDS = standardFeeds.filter((f) => f.category === "research");
export const ALL_FEEDS = enabledFeeds;
/** Domain-to-source mapping for Google News articles */
export const DOMAIN_SOURCE_MAP = config.domainSourceMap;
