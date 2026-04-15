import { log } from "../logger.js";
import { generateCategoryQueries } from "./generate-queries.js";
import { routeCategoryQueries, fetchShowHN } from "./search.js";
import { fetchMonitorEvents } from "./parallel-monitor.js";
import type { FirecrawlSearchResult } from "./search.js";
import { fetchArxivPapers } from "./feeds.js";
import { normalizeSearchResult } from "./normalize.js";
import { mapConcurrent } from "./concurrency.js";
import {
  evaluateContentRelevance,
  detectContentType,
  ensureResearchRepresentation,
} from "./evaluate.js";
import type { ScoredCandidate } from "./evaluate.js";
import { extractExternalSources } from "./extract-sources.js";
import * as s3 from "../storage/s3.js";
import type {
  NormalizedFeedItem,
  ContentMetadata,
  ScrapeResult,
} from "../storage/types.js";
import type { ContentType } from "./types.js";

interface DiscoveredItem {
  item: NormalizedFeedItem;
  searchResult: FirecrawlSearchResult;
  contentType: ContentType;
}

interface EvaluatedDiscovery extends DiscoveredItem {
  externalSources: string;
}

/**
 * Run the AI-powered discovery pipeline:
 * 1. Generate category-based queries, fetch arXiv + Show HN in parallel
 * 2. Normalize all sources to a common shape
 * 3. Deduplicate (cross-source + S3)
 * 4. Evaluate relevance with content-type-aware scoring
 * 5. Apply research representation guarantee
 * 6. Extract sources and upload to S3
 */
export async function runDiscovery(existingUrls: Set<string>): Promise<number> {
  const runId = `discovery-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`;
  log.info("Starting AI-powered news discovery...", { runId });
  const timer = log.timer("discovery-total");

  // Step 1: Fetch all sources in parallel
  // Monitor events are fetched first (pre-accumulated since last run),
  // then fresh search/discovery runs alongside arXiv and Show HN.
  const categoryQueries = generateCategoryQueries();

  const [monitorEvents, categoryResults, arxivPapers, showHNPosts] = await Promise.all([
    fetchMonitorEvents(25),
    routeCategoryQueries(categoryQueries),
    fetchArxivPapers(10),
    fetchShowHN("AI tool", 15),
  ]);

  log.info(
    `Sources: ${monitorEvents.length} monitor events, ` +
      `${categoryResults.length} category results, ` +
      `${arxivPapers.length} arXiv papers, ` +
      `${showHNPosts.length} Show HN posts`,
    { runId }
  );

  // Step 2: Normalize all sources to DiscoveredItem (FirecrawlSearchResult + contentType)
  const allItems: DiscoveredItem[] = [];

  // Monitor events (pre-accumulated, highest priority — deduplicated below)
  for (const event of monitorEvents) {
    if (!event.url) continue;
    const searchResult: FirecrawlSearchResult = {
      url: event.url,
      title: event.title,
      markdown: event.summary,
      description: event.summary.slice(0, 200),
    };
    allItems.push({
      item: normalizeSearchResult(searchResult),
      searchResult,
      contentType: event.contentType,
    });
  }

  for (const result of categoryResults) {
    const searchResult: FirecrawlSearchResult = {
      url: result.url,
      title: result.title,
      markdown: result.summary,
      description: result.summary.slice(0, 200),
    };
    allItems.push({
      item: normalizeSearchResult(searchResult),
      searchResult,
      contentType: detectContentType({ url: result.url }),
    });
  }

  for (const paper of arxivPapers) {
    const markdown =
      `# ${paper.title}\n\n` +
      `**Authors:** ${paper.authors.join(", ")}\n\n` +
      `**Published:** ${paper.publishedDate}\n\n` +
      `${paper.abstract}`;
    const searchResult: FirecrawlSearchResult = {
      url: paper.url,
      title: paper.title,
      markdown,
      description: paper.abstract.slice(0, 200),
    };
    allItems.push({
      item: normalizeSearchResult(searchResult),
      searchResult,
      contentType: "research",
    });
  }

  for (const hn of showHNPosts) {
    const markdown =
      `# ${hn.title}\n\n` +
      `Show HN — ${hn.points} points by ${hn.author}\n` +
      `Discussion: ${hn.commentUrl}`;
    const searchResult: FirecrawlSearchResult = {
      url: hn.url,
      title: hn.title,
      markdown,
      description: `Show HN: ${hn.points} points`,
    };
    allItems.push({
      item: normalizeSearchResult(searchResult),
      searchResult,
      contentType: "project",
    });
  }

  // Step 3: Deduplicate by URL
  const seenUrls = new Set<string>(existingUrls);
  const uniqueItems: DiscoveredItem[] = [];

  for (const discovered of allItems) {
    const url = discovered.item.url;
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    uniqueItems.push(discovered);
  }

  log.info(`${uniqueItems.length} unique items after deduplication`, { runId });

  if (uniqueItems.length === 0) {
    timer.end();
    return 0;
  }

  // Step 4: S3 dedup check
  const s3Checks = await Promise.all(
    uniqueItems.map(async (discovered) => {
      const exists = await s3.exists(discovered.item.uploadFileName);
      return { discovered, exists };
    })
  );

  const newItems = s3Checks
    .filter(({ exists }) => !exists)
    .map(({ discovered }) => discovered);

  log.info(`${newItems.length} new items after S3 dedup`, { runId });

  if (newItems.length === 0) {
    timer.end();
    return 0;
  }

  // Step 5: Evaluate relevance with content-type-aware scoring
  log.info(`Evaluating ${newItems.length} discovered items...`, { runId });

  const evalResults = await mapConcurrent(
    newItems,
    5,
    async (discovered): Promise<ScoredCandidate<DiscoveredItem> | null> => {
      const { item, searchResult, contentType } = discovered;
      const label = `[${item.sourceName}] ${item.title}`;
      const content = searchResult.markdown;

      if (!content || content.length < 100) {
        log.info(`SKIP (no/short content): ${label}`);
        return null;
      }

      const evaluation = await evaluateContentRelevance(content, contentType);
      return { item: discovered, contentType, evaluation };
    }
  );

  const passed: ScoredCandidate<DiscoveredItem>[] = [];
  const rejected: ScoredCandidate<DiscoveredItem>[] = [];

  for (const r of evalResults) {
    if (r.status === "rejected") {
      log.error("Discovery evaluate task failed", {
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
      continue;
    }
    if (r.value == null) continue;

    const { item, contentType, evaluation } = r.value;
    if (evaluation.isRelevant) {
      passed.push(r.value);
    } else {
      rejected.push(r.value);
      log.info(`SKIP (not relevant): [${item.item.sourceName}] ${item.item.title}`);
    }
  }

  // Step 6: Apply research representation guarantee
  const finalSelection = ensureResearchRepresentation(passed, rejected);

  const researchCount = finalSelection.filter((c) => c.contentType === "research").length;
  log.info(
    `${finalSelection.length}/${newItems.length} items selected (${researchCount} research)`,
    { runId }
  );

  if (finalSelection.length === 0) {
    timer.end();
    return 0;
  }

  // Step 7: Extract sources and upload to S3
  log.info(`Uploading ${finalSelection.length} discovered items...`, { runId });

  const uploadResults = await mapConcurrent(
    finalSelection,
    10,
    async ({ item: discovered }) => {
      const { item, searchResult } = discovered;
      const label = `[${item.sourceName}] ${item.title}`;

      const fakeScrape: ScrapeResult = {
        content: searchResult.markdown,
        mainContentImageUrls: [],
        rawHtml: "",
        links: [],
        metadata: { url: searchResult.url, title: searchResult.title },
      };

      const externalSources = await extractExternalSources(fakeScrape);

      const metadata: ContentMetadata = {
        key: `${item.uploadFileName}.md`,
        type: item.feedType,
        title: item.title,
        authors: item.authors,
        "source-name": item.sourceName,
        "external-source-urls": externalSources,
        "image-urls": "",
        url: item.url,
        timestamp: item.publishedTimestamp,
        "feed-url": item.feedUrl,
        "run-id": runId,
      };

      await s3.uploadWithMetadata(
        item.uploadFileName,
        searchResult.markdown,
        "",
        metadata
      );

      log.info(`STORED (discovered): ${label}`);
    }
  );

  let stored = 0;
  for (const r of uploadResults) {
    if (r.status === "fulfilled") {
      stored++;
    } else {
      log.error("Discovery upload task failed", {
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }

  timer.end();
  log.info("Discovery complete", {
    runId,
    categories: categoryQueries.length,
    arxivPapers: arxivPapers.length,
    showHNPosts: showHNPosts.length,
    categoryResults: categoryResults.length,
    unique: uniqueItems.length,
    newItems: newItems.length,
    selected: finalSelection.length,
    stored,
  });

  return stored;
}
