# Plan: Overhaul Content Ingestion Sources

## Problem
Current ingestion relies on a narrow set of sources (Google News, Hacker News, 3 subreddits, 6 company blogs) — all funneled through rss.app JSON feeds. This produces limited, tech-insider-skewed coverage. Missing: major news outlets, AI newsletters, tutorials, and research content.

## Goal
Expand ingestion to cover **4 content categories**: breaking news, expert analysis/newsletters, tutorials, and research — sourced from mainstream media, Substack, Medium, arxiv, and more.

---

## Phase 1: Add Native RSS Support

**Why:** Currently ALL feeds go through rss.app (a paid proxy). Most sources have native RSS feeds — we should consume them directly instead of paying for a proxy layer.

### Changes:
1. **Add new feed categories** to `FeedDefinition` and the Zod schema in `src/ingest/feeds.ts`:
   - Expand `category` enum: `"newsletter" | "json" | "reddit" | "blog"` → add `"news"`, `"substack"`, `"tutorial"`, `"research"`
   - Expand `feedType` enum: add `"tutorial"` and `"research"` alongside existing `"newsletter" | "article" | "subreddit"`
   - Add optional `"contentType"` field: `"news" | "tutorial" | "research" | "analysis"` — used during story selection to ensure mix

2. **Update `src/ingest/index.ts`** to export category-specific feed arrays (e.g., `NEWS_FEEDS`, `SUBSTACK_FEEDS`, `TUTORIAL_FEEDS`) and route them through `fetchRssFeedItems()` since they're standard RSS

3. **No changes needed** to the scrape/evaluate/upload pipeline — it's feed-format agnostic

### Files touched:
- `src/ingest/feeds.ts` — schema + exports
- `src/ingest/index.ts` — new feed arrays + fetchAllFeeds()
- `feeds.json` — new entries

---

## Phase 2: Add New Sources to `feeds.json`

### A. Substack AI Newsletters (native RSS — `{name}.substack.com/feed`)
| Newsletter | Feed URL | Why |
|---|---|---|
| Import AI (Jack Clark, co-founder Anthropic) | `https://importai.substack.com/feed` | Deep AI policy + research analysis |
| AI Supremacy (Michael Spencer) | `https://aisupremacy.substack.com/feed` | Broad AI industry coverage |
| The Algorithmic Bridge | `https://thealgorithmicbridge.substack.com/feed` | AI + society analysis |
| Ahead of AI (Sebastian Raschka) | `https://magazine.sebastianraschka.com/feed` | ML research deep dives |
| One Useful Thing (Ethan Mollick) | `https://www.oneusefulthing.org/feed` | Practical AI usage, Wharton prof |
| Interconnects (Nathan Lambert) | `https://www.interconnects.ai/feed` | RLHF/alignment research |
| SemiAnalysis | `https://www.semianalysis.com/feed` | AI hardware + infrastructure |

**Config:** `category: "substack"`, `feedType: "newsletter"`, `format: "rss"`

### B. Major News Outlets (native RSS)
| Source | Feed URL | Notes |
|---|---|---|
| NYT Technology | `https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml` | Headlines + excerpts (paywall) |
| WSJ Tech | `https://feeds.content.dowjones.io/public/rss/RSSWSJD` | Headlines + excerpts (paywall) |
| Wired AI | `https://www.wired.com/feed/tag/ai/latest/rss` | Full articles, AI-specific |
| VentureBeat AI | `https://venturebeat.com/category/ai/feed/` | Full articles, AI-specific |
| The Verge AI | `https://www.theverge.com/rss/ai-artificial-intelligence/index.xml` | AI section feed |
| TechCrunch | `https://techcrunch.com/feed/` | General tech, filter for AI in eval |
| Ars Technica | `https://feeds.arstechnica.com/arstechnica/technology-lab` | Deep tech coverage |
| Fast Company AI | `https://www.fastcompany.com/section/artificial-intelligence/rss` | Business + AI |
| MarkTechPost | `https://www.marktechpost.com/feed/` | AI research news |
| MIT News AI | `https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml` | Academic AI news |
| Forbes AI | `https://www.forbes.com/ai/feed/` | Business AI coverage |

**Config:** `category: "news"`, `feedType: "article"`, `format: "rss"`

**Note on paywalled sources (NYT, WSJ, Forbes):** RSS gives headlines + excerpts. Firecrawl may not scrape full articles behind paywalls. Two options:
- **Option A (recommended):** Keep them — even excerpts provide signal for story discovery. The evaluate stage will skip items with too-thin content. The discovery pipeline (Stage 5) can then search for the same story on non-paywalled sources.
- **Option B:** Drop them if they produce too much noise.

### C. Tutorial Sources
| Source | Feed URL | Notes |
|---|---|---|
| Towards Data Science | `https://towardsdatascience.com/feed` | ML tutorials (some paywalled) |
| Towards AI | `https://pub.towardsai.net/feed` | AI tutorials |
| Machine Learning Mastery | `https://machinelearningmastery.com/blog/feed/` | Practical ML tutorials |
| Analytics Vidhya | `https://www.analyticsvidhya.com/feed/` | Data science tutorials |
| HuggingFace Blog | `https://huggingface.co/blog/feed.xml` | Model tutorials + releases |
| Google Research Blog | `https://research.google/blog/rss/` | Research + applied tutorials |

**Config:** `category: "tutorial"`, `feedType: "tutorial"`, `format: "rss"`

### D. Research Sources
| Source | Feed URL | Notes |
|---|---|---|
| Arxiv AI + ML | `https://rss.arxiv.org/rss/cs.AI+cs.LG` | Daily paper listings |
| Arxiv NLP | `https://rss.arxiv.org/rss/cs.CL` | NLP papers |
| BAIR Blog | `https://bair.berkeley.edu/blog/feed.xml` | Berkeley AI research |

**Config:** `category: "research"`, `feedType: "research"`, `format: "rss"`

### E. Keep Existing Sources (unchanged)
- Google News (JSON via rss.app) — catches stories from Bloomberg, Reuters, etc.
- Hacker News (JSON via rss.app) — community-driven signals
- Reddit r/OpenAI, r/ArtificialIntelligence, r/artificial — community signals
- Official blogs: OpenAI, NVIDIA, Google AI, Anthropic, Cloudflare, Meta

### F. Remove/Disable
- The 6 disabled newsletter sources (Rundown AI, Neuron, etc.) — remove from config entirely since we're replacing them with direct Substack feeds

### G. Expand `domainSourceMap`
Add new domains for proper source attribution in Google News items:
```json
"wired.com": "wired",
"arstechnica.com": "ars-technica",
"technologyreview.com": "mit-technology-review",
"fastcompany.com": "fast-company",
"marktechpost.com": "marktechpost",
"towardsdatascience.com": "towards-data-science",
"huggingface.co": "huggingface",
"machinelearningmastery.com": "ml-mastery",
"wsj.com": "wall-street-journal",
"news.mit.edu": "mit-news"
```

---

## Phase 3: Update Story Selection to Use Content Types

**File:** `src/generate/select-stories.ts`

Update the Kimi K2 story selection prompt to be aware of content types. Currently it selects 4 stories — we should:

1. Pass `feedType` (article/tutorial/research/newsletter) as metadata alongside each story
2. Update selection criteria to **prefer a mix**: at minimum 1 tutorial or research piece when available
3. Update the shortlist writer to tag tutorials with a "[Tutorial]" or "[Research]" prefix

This is a prompt-level change, no structural code change needed.

---

## Phase 4: Update Discovery Queries

**File:** `src/ingest/generate-queries.ts`

Update the Mistral query generation prompt to also generate tutorial-focused queries, e.g.:
- "how to fine-tune [model] tutorial 2026"
- "AI coding assistant tutorial guide"
- "building agents with [framework] step by step"

Currently generates 5-8 news-focused queries. Expand to 8-12 queries with 2-3 being tutorial/how-to focused.

---

## Phase 5: Make.com Integration (Optional / Parallel Track)

This is a **supplementary discovery layer**, not a replacement for the feed pipeline.

### Architecture:
1. **Make.com scenario** runs daily, uses OpenAI module with prompt: "Find the top 10 trending AI news stories today"
2. Make.com outputs a JSON array of `{ title, url, summary }` objects
3. Make.com calls a **webhook endpoint** on your pipeline (or writes to a Google Sheet)
4. Your pipeline reads the webhook/sheet and feeds items into the existing scrape → evaluate → upload pipeline

### Implementation:
- Add a `src/ingest/webhook.ts` module that accepts POST requests with story URLs
- Or simpler: Make.com writes URLs to a text file in S3, and your ingestion reads it as an additional "feed"
- The URLs from Make.com would enter the pipeline at the same point as discovery results

**Recommendation:** Defer this to after Phase 1-4 are working. The expanded RSS feeds + existing Firecrawl discovery will likely cover 95% of what Make.com would find.

---

## Phase 6: Evaluate Pipeline Tuning

After adding ~25+ new RSS feeds, the ingestion will produce significantly more items. Consider:

1. **Rate limiting:** Current Firecrawl concurrency is 3. May need to increase to 5 for faster throughput, or batch process by category.
2. **Relevance threshold:** With more tutorial content, update the Mistral evaluation prompt (`src/ingest/evaluate.ts`) to also accept tutorials/guides as relevant (currently focuses on "AI news").
3. **Deduplication:** Same story may appear in NYT, Wired, and VentureBeat. The S3 existence check deduplicates by upload filename (title-based slug), but same-story-different-sources won't be caught. Consider adding URL-domain dedup at the normalize stage.
4. **Arxiv volume:** The cs.AI+cs.LG feed can produce 50-100+ papers/day. Add a filter: only scrape papers with 5+ citations, or use the evaluate stage to aggressively filter.

---

## Implementation Order

1. **Phase 1** — Feed schema changes (~30 min)
2. **Phase 2** — Add all new feed entries to `feeds.json` (~20 min)
3. **Phase 3** — Update story selection prompt (~15 min)
4. **Phase 4** — Update discovery queries (~15 min)
5. **Phase 6** — Evaluate prompt tuning (~15 min)
6. Test full pipeline run
7. **Phase 5** — Make.com integration (separate effort, can be done later)

---

## Files Modified

| File | Change |
|---|---|
| `feeds.json` | Add ~25 new feeds, expand domainSourceMap, remove disabled newsletters |
| `src/ingest/feeds.ts` | Expand category/feedType enums, add new feed array exports |
| `src/ingest/index.ts` | Wire new feed categories into fetchAllFeeds() |
| `src/ingest/generate-queries.ts` | Add tutorial-focused query generation |
| `src/ingest/evaluate.ts` | Update relevance prompt to accept tutorials/research |
| `src/generate/select-stories.ts` | Pass content type metadata, encourage mix |
| `src/generate/write-shortlist.ts` | Tag tutorials/research in shortlist |

## Files NOT Modified
- Scrape pipeline (`scrape.ts`) — works with any URL
- S3 storage (`s3.ts`) — format-agnostic
- Email delivery (`send.ts`) — no changes
- Normalize (`normalize.ts`) — RSS normalization already works for all new feeds
