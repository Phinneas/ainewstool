import { z } from "zod/v4";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { log } from "../logger.js";
const FeedSchema = z.object({
    name: z.string(),
    sourceName: z.string(),
    feedType: z.enum(["newsletter", "article", "subreddit"]),
    feedUrl: z.string().url(),
    format: z.enum(["rss", "json"]),
    httpUrl: z.string().url().optional(),
    subreddit: z.string().optional(),
    category: z.enum(["newsletter", "json", "reddit", "blog"]),
    enabled: z.boolean(),
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
export const NEWSLETTER_FEEDS = enabledFeeds.filter((f) => f.category === "newsletter");
export const JSON_FEEDS = enabledFeeds.filter((f) => f.category === "json");
export const REDDIT_FEEDS = enabledFeeds.filter((f) => f.category === "reddit");
export const BLOG_FEEDS = enabledFeeds.filter((f) => f.category === "blog");
export const ALL_FEEDS = enabledFeeds;
/** Domain-to-source mapping for Google News articles */
export const DOMAIN_SOURCE_MAP = config.domainSourceMap;
