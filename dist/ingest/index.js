import RssParser from "rss-parser";
import { NEWSLETTER_FEEDS, JSON_FEEDS, BLOG_FEEDS, REDDIT_FEEDS, NEWS_FEEDS, SUBSTACK_FEEDS, TUTORIAL_FEEDS, RESEARCH_FEEDS, SCRAPED_PAGE_FEEDS, } from "./feeds.js";
import { fetchScrapedPageFeedItems } from "./scrape-page.js";
import { log } from "../logger.js";
import { mapConcurrent } from "./concurrency.js";
import { normalizeRssItem, normalizeJsonFeedItem, normalizeGoogleNewsItem, normalizeRedditItem, } from "./normalize.js";
import { processRedditFeedItems } from "./reddit.js";
import { scrapeUrl } from "./scrape.js";
import { evaluateContentRelevance } from "./evaluate.js";
import { extractExternalSources } from "./extract-sources.js";
import { runDiscovery } from "./discover.js";
import * as s3 from "../storage/s3.js";
const rssParser = new RssParser();
// ---------------------------------------------------------------------------
// Feed fetching (unchanged — already parallel via Promise.allSettled)
// ---------------------------------------------------------------------------
async function fetchJsonFeed(url) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
    return (await response.json());
}
async function fetchRssFeedItems(feed) {
    try {
        const url = feed.httpUrl ?? feed.feedUrl;
        const parsed = await rssParser.parseURL(url);
        return parsed.items.map((item) => normalizeRssItem({
            title: item.title,
            link: item.link,
            creator: item.creator,
            pubDate: item.pubDate,
            isoDate: item.isoDate,
        }, feed.sourceName, feed.feedType, feed.feedUrl));
    }
    catch (err) {
        log.error(`Error fetching RSS feed ${feed.name}`, {
            error: err instanceof Error ? err.message : String(err),
        });
        return [];
    }
}
async function fetchJsonFeedItems(feed) {
    try {
        const data = await fetchJsonFeed(feed.httpUrl);
        if (feed.name === "google_news") {
            return data.items.map((item) => normalizeGoogleNewsItem(item, feed.feedUrl));
        }
        return data.items.map((item) => normalizeJsonFeedItem(item, feed.sourceName, feed.feedType, feed.feedUrl));
    }
    catch (err) {
        log.error(`Error fetching JSON feed ${feed.name}`, {
            error: err instanceof Error ? err.message : String(err),
        });
        return [];
    }
}
async function fetchRedditFeedItems(feed) {
    try {
        const data = await fetchJsonFeed(feed.httpUrl);
        const processed = await processRedditFeedItems(data.items.map((item) => ({
            url: item.url ?? "",
            title: item.title,
        })), feed.subreddit);
        return processed.map((item) => normalizeRedditItem(item, feed.feedUrl));
    }
    catch (err) {
        log.error(`Error fetching Reddit feed ${feed.name}`, {
            error: err instanceof Error ? err.message : String(err),
        });
        return [];
    }
}
async function fetchAllFeeds() {
    log.info("Fetching all feeds...");
    const fetchTimer = log.timer("fetch-all-feeds");
    // Separate Reddit feeds by format (json uses rss.app, rss uses native Reddit RSS)
    const redditJsonFeeds = REDDIT_FEEDS.filter((f) => f.format === "json");
    const redditRssFeeds = REDDIT_FEEDS.filter((f) => f.format === "rss");
    const results = await Promise.allSettled([
        ...NEWSLETTER_FEEDS.map((feed) => fetchRssFeedItems(feed)),
        ...JSON_FEEDS.map((feed) => fetchJsonFeedItems(feed)),
        ...BLOG_FEEDS.map((feed) => fetchJsonFeedItems(feed)),
        ...redditJsonFeeds.map((feed) => fetchRedditFeedItems(feed)),
        ...redditRssFeeds.map((feed) => fetchRssFeedItems(feed)),
        ...NEWS_FEEDS.map((feed) => fetchRssFeedItems(feed)),
        ...SUBSTACK_FEEDS.map((feed) => fetchRssFeedItems(feed)),
        ...TUTORIAL_FEEDS.map((feed) => fetchRssFeedItems(feed)),
        ...RESEARCH_FEEDS.map((feed) => fetchRssFeedItems(feed)),
        // Scraped-page feeds: scrape blog index pages for article links
        ...SCRAPED_PAGE_FEEDS.map((feed) => fetchScrapedPageFeedItems(feed)),
    ]);
    const items = [];
    for (const result of results) {
        if (result.status === "fulfilled") {
            items.push(...result.value);
        }
    }
    fetchTimer.end();
    log.info(`Fetched ${items.length} total feed items`);
    return items;
}
// ---------------------------------------------------------------------------
// Staged Pipeline
// ---------------------------------------------------------------------------
/** Stage 1: Filter — batch check S3 existence, return only new items. */
async function stageFilter(items) {
    log.info(`Stage 1: Filtering ${items.length} items against S3...`);
    const filterTimer = log.timer("stage-filter");
    const checks = await Promise.all(items.map(async (item) => {
        const exists = await s3.exists(item.uploadFileName);
        return { item, exists };
    }));
    const newItems = checks
        .filter(({ exists }) => !exists)
        .map(({ item }) => item);
    const skippedCount = items.length - newItems.length;
    filterTimer.end();
    log.info(`Stage 1 complete: ${newItems.length} new, ${skippedCount} already exist`);
    return newItems;
}
/** Stage 2: Scrape — fetch content via Firecrawl, concurrency limited. */
async function stageScrape(items) {
    // Increase concurrency to 8 for better throughput while respecting rate limits
    const concurrency = 8;
    log.info(`Stage 2: Scraping ${items.length} items (concurrency: ${concurrency})...`);
    const scrapeTimer = log.timer("stage-scrape");
    const results = await mapConcurrent(items, concurrency, async (item, index) => {
        const label = `[${item.sourceName}] ${item.title}`;
        const progress = `[${index + 1}/${items.length}]`;
        log.info(`${progress} SCRAPING: ${label}`);
        const result = await scrapeUrl(item.url);
        if (!result || !result.content) {
            log.warn(`${progress} SKIP (scrape failed): ${label}`);
            return null;
        }
        return { item, scrapeResult: result };
    });
    const scraped = [];
    for (const r of results) {
        if (r.status === "fulfilled" && r.value != null) {
            scraped.push(r.value);
        }
        else if (r.status === "rejected") {
            log.error("Scrape task failed", {
                error: r.reason instanceof Error ? r.reason.message : String(r.reason),
            });
        }
    }
    scrapeTimer.end();
    log.info(`Stage 2 complete: ${scraped.length}/${items.length} scraped successfully`);
    return scraped;
}
/** Stage 3: Evaluate — relevance check + external source extraction, concurrency limited. */
async function stageEvaluate(items) {
    // Increase concurrency to 12 since LLM calls are faster than scraping
    const concurrency = 12;
    log.info(`Stage 3: Evaluating ${items.length} items (concurrency: ${concurrency})...`);
    const evalTimer = log.timer("stage-evaluate");
    const results = await mapConcurrent(items, concurrency, async ({ item, scrapeResult }, index) => {
        const label = `[${item.sourceName}] ${item.title}`;
        const progress = `[${index + 1}/${items.length}]`;
        const evaluation = await evaluateContentRelevance(scrapeResult.content);
        if (!evaluation.isRelevant) {
            log.info(`${progress} SKIP (not relevant): ${label}`);
            return null;
        }
        const externalSources = await extractExternalSources(scrapeResult);
        return { item, scrapeResult, externalSources };
    });
    const evaluated = [];
    for (const r of results) {
        if (r.status === "fulfilled" && r.value != null) {
            evaluated.push(r.value);
        }
        else if (r.status === "rejected") {
            log.error("Evaluate task failed", {
                error: r.reason instanceof Error ? r.reason.message : String(r.reason),
            });
        }
    }
    evalTimer.end();
    log.info(`Stage 3 complete: ${evaluated.length}/${items.length} relevant`);
    return evaluated;
}
/** Stage 4: Upload — store content + metadata to S3, concurrency limited. */
async function stageUpload(items) {
    // Increase concurrency to 15 for S3 uploads (very fast)
    const concurrency = 15;
    log.info(`Stage 4: Uploading ${items.length} items (concurrency: ${concurrency})...`);
    const uploadTimer = log.timer("stage-upload");
    const results = await mapConcurrent(items, concurrency, async ({ item, scrapeResult, externalSources }, index) => {
        const label = `[${item.sourceName}] ${item.title}`;
        const progress = `[${index + 1}/${items.length}]`;
        const metadata = {
            key: `${item.uploadFileName}.md`,
            type: item.feedType,
            // Prefer the title extracted by Firecrawl from the actual page over the
            // placeholder title derived from the URL slug (used by scraped_page feeds).
            title: scrapeResult.metadata.title || item.title,
            authors: item.authors,
            "source-name": item.sourceName,
            "external-source-urls": externalSources,
            "image-urls": scrapeResult.mainContentImageUrls.join(","),
            url: item.url,
            timestamp: item.publishedTimestamp,
            "feed-url": item.feedUrl,
        };
        await s3.uploadWithMetadata(item.uploadFileName, scrapeResult.content, scrapeResult.rawHtml, metadata);
        log.info(`${progress} STORED: ${label}`);
    });
    let stored = 0;
    for (const r of results) {
        if (r.status === "fulfilled") {
            stored++;
        }
        else {
            log.error("Upload task failed", {
                error: r.reason instanceof Error ? r.reason.message : String(r.reason),
            });
        }
    }
    uploadTimer.end();
    log.info(`Stage 4 complete: ${stored}/${items.length} uploaded`);
    return stored;
}
// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export async function runIngestion() {
    log.info("Starting AI News Data Ingestion");
    const totalTimer = log.timer("ingestion-total");
    // Fetch all feed items (already parallel)
    const allItems = await fetchAllFeeds();
    // Stage 1: Filter out items already in S3
    const newItems = await stageFilter(allItems);
    let stored = 0;
    if (newItems.length > 0) {
        // Stage 2: Scrape new items
        const scraped = await stageScrape(newItems);
        // Stage 3: Evaluate relevance + extract sources
        const evaluated = await stageEvaluate(scraped);
        // Stage 4: Upload to S3
        stored = await stageUpload(evaluated);
    }
    else {
        log.info("No new feed items to process");
    }
    // Stage 5: AI-powered discovery — find news from across the web
    const feedUrls = new Set(allItems.map((item) => item.url));
    const discoveredCount = await runDiscovery(feedUrls);
    totalTimer.end();
    log.info("Ingestion Complete", {
        totalFeedItems: allItems.length,
        newFeedItems: newItems.length,
        storedFromFeeds: stored,
        storedFromDiscovery: discoveredCount,
        totalStored: stored + discoveredCount,
    });
}
