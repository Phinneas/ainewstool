import { log } from "../logger.js";
import { generateSearchQueries } from "./generate-queries.js";
import { firecrawlSearch, type FirecrawlSearchResult } from "./search.js";
import { normalizeSearchResult } from "./normalize.js";
import { mapConcurrent } from "./concurrency.js";
import { evaluateContentRelevance } from "./evaluate.js";
import { extractExternalSources } from "./extract-sources.js";
import * as s3 from "../storage/s3.js";
import type {
  NormalizedFeedItem,
  ContentMetadata,
  ScrapeResult,
} from "../storage/types.js";

interface DiscoveredItem {
  item: NormalizedFeedItem;
  searchResult: FirecrawlSearchResult;
}

interface EvaluatedDiscovery extends DiscoveredItem {
  externalSources: string;
}

/**
 * Run the AI-powered discovery pipeline:
 * 1. Generate search queries via Mistral
 * 2. Search the web via Firecrawl for each query
 * 3. Deduplicate results (across queries + against S3)
 * 4. Evaluate relevance + extract sources
 * 5. Upload to S3
 *
 * @param existingUrls - URLs already processed from feed ingestion (to skip)
 */
export async function runDiscovery(existingUrls: Set<string>): Promise<number> {
  log.info("Starting AI-powered news discovery...");
  const timer = log.timer("discovery-total");

  // Step 1: Generate queries
  const queries = await generateSearchQueries();

  // Step 2: Search for each query
  log.info(`Searching with ${queries.length} queries...`);
  const allResults: Array<{ query: string; result: FirecrawlSearchResult }> = [];

  for (const query of queries) {
    const results = await firecrawlSearch(query, 5);
    for (const result of results) {
      allResults.push({ query, result });
    }
  }

  log.info(`Got ${allResults.length} total search results across all queries`);

  // Step 3: Deduplicate by URL
  const seenUrls = new Set<string>(existingUrls);
  const uniqueResults: FirecrawlSearchResult[] = [];

  for (const { result } of allResults) {
    if (!result.url || seenUrls.has(result.url)) continue;
    seenUrls.add(result.url);
    uniqueResults.push(result);
  }

  log.info(`${uniqueResults.length} unique results after deduplication`);

  if (uniqueResults.length === 0) {
    timer.end();
    return 0;
  }

  // Check S3 existence for dedup
  const normalizedItems = uniqueResults.map((r) => ({
    item: normalizeSearchResult(r),
    searchResult: r,
  }));

  const s3Checks = await Promise.all(
    normalizedItems.map(async ({ item, searchResult }) => {
      const exists = await s3.exists(item.uploadFileName);
      return { item, searchResult, exists };
    })
  );

  const newItems: DiscoveredItem[] = s3Checks
    .filter(({ exists }) => !exists)
    .map(({ item, searchResult }) => ({ item, searchResult }));

  log.info(`${newItems.length} new items after S3 dedup`);

  if (newItems.length === 0) {
    timer.end();
    return 0;
  }

  // Step 4: Evaluate relevance + extract sources
  log.info(`Evaluating ${newItems.length} discovered items...`);

  const evalResults = await mapConcurrent(newItems, 5, async ({ item, searchResult }) => {
    const label = `[${item.sourceName}] ${item.title}`;
    const content = searchResult.markdown;

    if (!content || content.length < 100) {
      log.info(`SKIP (no/short content): ${label}`);
      return null;
    }

    const evaluation = await evaluateContentRelevance(content);
    if (!evaluation.isRelevant) {
      log.info(`SKIP (not relevant): ${label}`);
      return null;
    }

    // Build a ScrapeResult-like object for extractExternalSources
    const fakeScrape: ScrapeResult = {
      content,
      mainContentImageUrls: [],
      rawHtml: "",
      links: [],
      metadata: { url: searchResult.url, title: searchResult.title },
    };

    const externalSources = await extractExternalSources(fakeScrape);
    return { item, searchResult, externalSources } as EvaluatedDiscovery;
  });

  const evaluated: EvaluatedDiscovery[] = [];
  for (const r of evalResults) {
    if (r.status === "fulfilled" && r.value != null) {
      evaluated.push(r.value);
    } else if (r.status === "rejected") {
      log.error("Discovery evaluate task failed", {
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }

  log.info(`${evaluated.length}/${newItems.length} discovered items are relevant`);

  if (evaluated.length === 0) {
    timer.end();
    return 0;
  }

  // Step 5: Upload to S3
  log.info(`Uploading ${evaluated.length} discovered items...`);

  const uploadResults = await mapConcurrent(evaluated, 10, async ({ item, searchResult, externalSources }) => {
    const label = `[${item.sourceName}] ${item.title}`;

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
    };

    await s3.uploadWithMetadata(
      item.uploadFileName,
      searchResult.markdown,
      "",
      metadata
    );

    log.info(`STORED (discovered): ${label}`);
  });

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
    queries: queries.length,
    totalResults: allResults.length,
    unique: uniqueResults.length,
    newItems: newItems.length,
    relevant: evaluated.length,
    stored,
  });

  return stored;
}
