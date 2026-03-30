# Firecrawl Fallback-Only Implementation Plan

## Decision: Keep Firecrawl for Edge Cases Only

Firecrawl will be used as a **last resort fallback** when free methods fail:
- Primary: Jina Reader (free)
- Secondary: Native fetch (free)
- Tertiary: Firecrawl (paid, edge cases only)

---

## Phase 1: Remove from Discovery Search (Immediate - High Savings)

### File: `src/ingest/discover.ts`

**Current code:**
```typescript
const [firecrawlResults, exaResults] = await Promise.all([
  firecrawlSearch(query, 5),
  exaSearch(query, 5),
]);

for (const result of [...firecrawlResults, ...exaResults]) {
  allResults.push({ query, result });
}
```

**New code:**
```typescript
const exaResults = await exaSearch(query, 5);

for (const result of exaResults) {
  allResults.push({ query, result });
}
```

**Changes:**
- Remove `firecrawlSearch` import
- Remove parallel Firecrawl call
- Update log message: `"Searching with ${queries.length} queries (Exa only)..."`

**Cost savings:** ~8-12 Firecrawl search API calls per ingestion run

---

## Phase 2: Scraped Page Feeds - Native First, Firecrawl Fallback

### File: `src/ingest/scrape-page.ts`

**Current flow:**
```
Firecrawl scrape (formats: ["links"])
```

**New flow:**
```
1. Try native fetch + extractLinksFromHtml() (free)
2. If no links found, try Firecrawl as fallback (paid)
```

### Implementation:

```typescript
/**
 * Multi-tier index page link extraction:
 * 1. Native fetch + HTML link extraction (free)
 * 2. Firecrawl links-only scrape (paid, fallback)
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
      linkCount: nativeLinks.length 
    });
    return nativeLinks;
  }

  log.warn("[scrape-page] Native fetch failed or returned no links, trying Firecrawl fallback", { 
    url: indexUrl 
  });

  // Tier 2: Firecrawl fallback (paid)
  return await fetchFirecrawlLinks(indexUrl, apiKey);
}

/**
 * Native fetch + HTML link extraction (free).
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
        url: indexUrl 
      });
      return [];
    }

    const html = await response.text();
    
    // Use existing extractLinksFromHtml from scrape.ts
    // Need to import or duplicate the function
    const links = extractLinksFromHtml(html);
    
    return links;
  } catch (err) {
    log.debug("[scrape-page] Native fetch error", { 
      error: err instanceof Error ? err.message : String(err),
      url: indexUrl 
    });
    return [];
  }
}

/**
 * Firecrawl links-only scrape (paid, fallback for edge cases).
 */
async function fetchFirecrawlLinks(
  indexUrl: string,
  apiKey: string
): Promise<string[]> {
  const body = {
    url: indexUrl,
    formats: ["links"],
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
        linkCount: data.data?.links?.length ?? 0
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
```

**Cost impact:**
- Native fetch succeeds ~90% of the time = 90% cost reduction
- Firecrawl only used for JavaScript-heavy or blocked sites

---

## Phase 3: Article Scraping - Already Fallback-Ready

### File: `src/ingest/scrape.ts`

**Current flow:**
```
1. Jina Reader (free) ← Primary
2. Native fetch + HTML extraction (free) ← Fallback
```

**Firecrawl is NOT currently used** for article scraping. Good.

**Optional: Add Firecrawl as tertiary fallback:**

```typescript
/**
 * Multi-tier web scraping with automatic fallbacks:
 * 1. Jina Reader (primary) - free, no API key, returns markdown
 * 2. Native fetch + HTML extraction (fallback) - works everywhere
 * 3. Firecrawl (last resort) - for JavaScript-heavy or blocked sites
 */
export async function scrapeUrl(url: string, apiKey?: string): Promise<ScrapeResult | null> {
  // Tier 1: Jina Reader
  const jinaResult = await tryJinaReader(url);
  if (jinaResult) {
    log.debug(`Jina Reader success`, { url });
    return jinaResult;
  }

  log.warn(`Jina Reader failed, trying native fetch`, { url });

  // Tier 2: Native fetch
  const nativeResult = await tryNativeFetch(url);
  if (nativeResult) {
    log.debug(`Native fetch success`, { url });
    return nativeResult;
  }

  // Tier 3: Firecrawl (only if API key provided and both free methods failed)
  if (apiKey) {
    log.warn(`Native fetch failed, trying Firecrawl as last resort`, { url });
    const firecrawlResult = await tryFirecrawlScrape(url, apiKey);
    if (firecrawlResult) {
      log.debug(`Firecrawl success (edge case)`, { url });
      return firecrawlResult;
    }
  }

  log.warn(`All scraping methods failed`, { url });
  return null;
}

/**
 * Firecrawl article scrape (paid, for edge cases only).
 */
async function tryFirecrawlScrape(url: string, apiKey: string): Promise<ScrapeResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json() as {
      success: boolean;
      data?: { markdown?: string; metadata?: { title?: string } };
    };

    if (!data.success || !data.data?.markdown) return null;

    return {
      content: data.data.markdown,
      mainContentImageUrls: [], // Firecrawl doesn't extract images in this mode
      rawHtml: "",
      links: extractLinks(data.data.markdown),
      metadata: {
        url,
        title: data.data.metadata?.title || extractTitleFromUrl(url),
      },
    };
  } catch (err) {
    log.debug(`Firecrawl scrape error`, { 
      error: err instanceof Error ? err.message : String(err),
      url 
    });
    return null;
  }
}
```

---

## Implementation Checklist

### Immediate (High Impact, Low Risk):
- [ ] **Remove Firecrawl from `discover.ts`** discovery search
  - Delete `firecrawlSearch` import
  - Remove parallel Firecrawl call
  - Keep only Exa search
  - Update log messages

### Near-Term (Medium Impact, Low Risk):
- [ ] **Update `scrape-page.ts`** for native-first approach
  - Add `tryNativeFetchLinks()` function
  - Rename existing function to `fetchFirecrawlLinks()`
  - Update `fetchIndexPageLinks()` to try native first, Firecrawl fallback

### Optional (Low Impact, Safety Net):
- [ ] **Add Firecrawl tertiary fallback to `scrape.ts`**
  - Only if you encounter sites where Jina + native both fail
  - Requires passing API key through the call chain
  - Consider whether it's worth the added complexity

---

## Expected Cost Reduction

| Use Case | Before | After | Savings |
|----------|--------|-------|---------|
| Discovery search | 8-12 calls/run | 0 calls | **100%** |
| Scraped pages | 3 calls/run | ~0.3 calls/run (90% native success) | **90%** |
| Article scraping | 0 calls (already Jina) | 0 calls | N/A |

**Total savings:** ~95-100% reduction in Firecrawl costs

**Firecrawl will only trigger for:**
- JavaScript-rendered index pages (rare)
- Sites blocking both Jina and native fetch (very rare)
- Edge cases where free methods fail

---

## Testing Plan

1. **Test native fetch link extraction:**
   ```bash
   npm run ingest
   # Check logs for "[scrape-page] Native fetch succeeded"
   # Should see for Mistral, AllenAI, Stanford HAI feeds
   ```

2. **Monitor Firecrawl usage:**
   ```bash
   # After implementation, check logs for Firecrawl calls
   grep "Firecrawl" logs/*.log
   # Should only appear as "fallback" or "last resort"
   ```

3. **Verify no broken feeds:**
   - Confirm all 3 scraped page feeds still work
   - Check S3 for uploaded content from these sources

---

## Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `src/ingest/discover.ts` | Remove Firecrawl search | **Immediate** |
| `src/ingest/scrape-page.ts` | Native-first, Firecrawl fallback | Near-term |
| `src/ingest/scrape.ts` | Add Firecrawl tertiary fallback (optional) | Optional |

---

## Rollback Plan

If any feed breaks after changes:

1. **Revert `discover.ts`:** Restore Firecrawl parallel search
2. **Revert `scrape-page.ts`:** Use Firecrawl as primary for that specific feed
3. **Check Firecrawl dashboard:** Verify which URLs triggered fallback

---

## Monitoring

After implementation, track:

1. **Firecrawl API call count** (should drop to near-zero)
2. **Feed ingestion success rate** (should stay same)
3. **Content quality** (should stay same or improve)
4. **Error logs** (watch for "all methods failed")

---

## Summary

**Firecrawl becomes your "nuclear option"** - used only when:
- ✅ Jina Reader fails
- ✅ Native fetch fails
- ✅ Site has complex JavaScript
- ✅ Site blocks other scrapers

This maximizes cost savings while maintaining reliability for edge cases.
