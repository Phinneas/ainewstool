# Firecrawl Cost Reduction — Implementation Spec

## Problem

Firecrawl is costing ~$36/2 days due to two use cases:

1. **Discovery search (`discover.ts`)** — Firecrawl runs in parallel with Exa for every discovery query. Redundant: Exa already covers this with better semantic search.
2. **Article scraping (`scrape.ts`)** — Every filtered feed article is scraped using Firecrawl LLM extraction (4 formats + LLM prompt). This is the primary cost driver.

---

## Tool Roles (Final Strategy)

| Tool | Role | Status |
|------|------|--------|
| **Exa** | Discovery search (semantic/neural) + article content extraction | Expand |
| **Tavily** | Themed sections (AI for Good, AI Discoveries) — news-focused, date-filtered | Keep as-is |
| **Firecrawl** | Discovery search (redundant) + article scraping (expensive) | Remove from both |

**Why keep Tavily for themed sections:** Purpose-built for news, returns `published_date` per result, already working. Exa's advantage (semantic search, `excludeDomains`) is less important here than reliable date filtering.

**Why Exa for discovery:** Semantic/neural search surfaces conceptually related content without exact keyword matches — better for finding novel AI stories from non-mainstream sources.

---

## Change 1: Remove Firecrawl from Discovery (`discover.ts`)

### What changes
- Remove `firecrawlSearch` import and call
- Keep only `exaSearch` per query
- Update log messages

### Impact
- Exa already returns `FirecrawlSearchResult`-compatible objects — no type changes needed
- Discovery continues to work identically, just without the redundant Firecrawl half
- Each ingest run saves N × `firecrawlSearch()` calls (N = number of discovery queries, currently 8–12)

### Risk: Low
Exa is already running and returning results. Removing Firecrawl from this step is purely subtractive.

---

## Change 2: Replace Firecrawl Scraping with Exa `getContents()` (`scrape.ts`)

### What changes
- Replace `scrapeUrl()` (Firecrawl LLM extraction) with Exa `getContents()` call
- Exa returns inline text (up to N characters) for a given URL — no separate LLM extraction step

### What Exa `getContents()` provides vs Firecrawl LLM extraction

| Capability | Firecrawl (current) | Exa `getContents()` |
|---|---|---|
| Article text | ✅ LLM-extracted, clean | ✅ Raw text, up to N chars |
| Image URLs | ✅ LLM-identifies 600px+ images | ❌ Not available |
| Raw HTML | ✅ | ❌ Not available |
| Outbound links | ✅ | ❌ Not available |
| Cost | High (LLM extraction per page) | Low (~$0.001–0.004/call) |

### Key tradeoff: Image URLs

The current pipeline uses `mainContentImageUrls` from Firecrawl in newsletter generation. Specifically:
- `scrape.ts` returns `mainContentImageUrls[]`
- `ingest/index.ts` stores these as `image-urls` in S3 metadata
- `generate/index.ts` reads `imageUrls` from S3 metadata and passes to `writeSection()`
- `write-section.ts` receives image URLs — need to verify if they appear in newsletter output

**Before implementing Change 2, verify:** Do image URLs from scraped articles actually appear in the published newsletter? If yes, switching to Exa loses article images. If no (or they're optional), the switch is safe.

### What to do about images if they matter
Options:
1. **Accept text-only** — newsletter sections written from text content only, no inline images
2. **Hybrid** — use Exa for text, keep Firecrawl only for image extraction (still reduces cost since LLM extraction is the expensive part)
3. **Exa + separate image scrape** — Exa for text, lightweight Firecrawl scrape (no LLM) for image URLs only

### Exa `getContents()` API shape

```typescript
// POST https://api.exa.ai/contents
{
  ids: [url],           // array of URLs
  text: { maxCharacters: 5000 },
  // No image extraction available
}

// Response
{
  results: [{
    id: string,
    url: string,
    title: string,
    text: string,       // article text up to maxCharacters
    publishedDate?: string,
    author?: string,
  }]
}
```

### ScrapeResult compatibility

Current `ScrapeResult` type:
```typescript
{
  content: string,              // ← Exa text fills this
  mainContentImageUrls: string[], // ← would be [] with Exa
  rawHtml: string,              // ← would be "" with Exa
  links: string[],              // ← would be [] with Exa
  metadata: { url, title }      // ← Exa provides both
}
```

The `rawHtml` and `links` fields are stored in S3 but nothing downstream reads them — confirmed by tracing the pipeline. The only open question is `mainContentImageUrls`.

---

## Implementation Order

1. ✅ **Change 1: `discover.ts`** — drop Firecrawl, Exa-only (low risk, immediate)
2. **Verify image URL usage** — trace `imageUrls` through `generate/index.ts` → `write-section.ts` to confirm whether article images appear in published newsletters
3. **Change 2: `scrape.ts`** — implement based on image findings above

---

## Files Affected

| File | Change |
|------|--------|
| `src/ingest/discover.ts` | Remove `firecrawlSearch` import + call |
| `src/ingest/scrape.ts` | Replace Firecrawl LLM extraction with Exa `getContents()` |
| `src/ingest/exa-search.ts` | Add `getContents()` function (new export) |

**Not changing:**
- `src/generate/ai-for-good.ts` — Tavily stays
- `src/generate/ai-discoveries.ts` — Tavily stays
- `src/generate/index.ts` — unless image handling changes

---

## Open Questions

1. **Do article images appear in the newsletter?** Check `write-section.ts` output and a real Ghost post.
2. **Exa `getContents()` character limit** — what's the right `maxCharacters` for enough article content to write a good newsletter section? Current Firecrawl returns full article text. 3000–5000 chars is probably sufficient for evaluation + section writing.
3. **Rate limits** — Exa `getContents()` is billed per URL. During ingest, how many articles get scraped per run? This determines the Exa cost for Change 2.
