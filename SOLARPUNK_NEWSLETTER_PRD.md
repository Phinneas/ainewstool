# Solarpunk Newsletter — Product Requirements Document

**Based on:** AINewsletter (Salish) codebase  
**Date:** 2026-04-24  
**Version:** 3.0  
**Status:** Implementation-ready

---

## 1. Overview

Port the AINewsletter pipeline into a branded **sustainability and solarpunk newsletter**. The architecture, LLM pipeline, storage layer, and worker infrastructure stay identical. What changes is the topic domain: sources, evaluation criteria, section structure, tone, branding, and social signal ingestion.

**Resolved decisions (from review):**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cadence | **Weekly** | Solarpunk content doesn't move at AI-news speed; weekly allows higher curation quality |
| Culture Picks | **Standalone section** | Reader intent for media recs differs from news; drives sharing |
| Doom Loop rule | **Hard filter at evaluate stage** | Prevents pipeline clutter; don't let selection see catastrophe-without-agency content |
| LLM provider | **Consolidate to Claude** for writing; keep Mistral for fast eval | Claude maintains warm/hopeful tone; Mistral stays for speed/cost on filtering |
| Research scope | **Expanded** to include indigenous knowledge, citizen science, open-source hardware | Solarpunk ethos extends beyond academic journals |

**Newsletter name:** *Solarpunk Currents* — chosen by the team. See name evaluation in §10.

---

## 2. Content Pillars

| Pillar | Description |
|--------|-------------|
| **Green Tech & Innovation** | Clean energy, EVs, sustainable materials, climate tech, open-source hardware |
| **Policy & Activism** | Climate legislation, international agreements, grassroots campaigns, victories |
| **Culture** | Films, TV, documentaries, music, fiction, art with environmental or solarpunk themes |
| **Community & Local Action** | Urban farming, mutual aid, repair cafes, permaculture, local resilience projects |

---

## 3. What Does NOT Change

Reused verbatim from the AINewsletter codebase:

- `src/llm/` — all LLM clients and the `LLMClient` interface
- `src/storage/` — S3/R2 storage layer, metadata serializer, content types
- `src/ingest/normalize.ts` — feed item normalization and slug generation
- `src/ingest/scrape.ts`, `scrape-page.ts` — Firecrawl scraping
- `src/ingest/extract-sources.ts` — external link extraction
- `src/ingest/reddit.ts` — Reddit API client (reused; just pointed at new subreddits)
- `src/ingest/concurrency.ts`, `parallel-monitor.ts` — concurrency utilities
- `src/ingest/exa-search.ts`, `tavily-search.ts` — web search clients
- `src/worker/` — Cloudflare Worker, KV storage, scheduling, handlers
- `src/utils/` — logo system, image processor, cache manager, monitoring
- `src/email/send.ts` — Resend email delivery
- `src/ghost/` — Ghost CMS publishing integration
- `src/cli.ts` — CLI entry point
- `src/config.ts` — env config (additions only, no breaking changes)
- All test infrastructure

---

## 4. What Changes

### 4.1 Project Identity

| Item | AINewsletter | New value |
|------|-------------|-----------|
| `package.json` name | `salish` | `solarpunk-currents` |
| Newsletter display name | *Salish* | *Solarpunk Currents* (TBD) |
| Logo asset | `src/assets/logo.png` | Replace with new brand asset |
| Ghost tag | `ai-newsletter` | `solarpunk-currents` |
| Worker User-Agent strings | `salish-newsletter-bot/1.0` | `solarpunk-currents-bot/1.0` |

---

### 4.2 `feeds.json` — Complete Replacement

All 17 existing feeds are replaced. The `FeedDefinition` Zod schema in `src/ingest/feeds.ts` needs two additions to the enum values:

**Add to `category` enum:**
```
"culture" | "policy" | "community"
```

**Add to `feedType` enum:**
```
"culture"
```

The `format` enum gains two new values to support social ingestion (see §4.10):
```
"mastodon_hashtag" | "bluesky_hashtag" | "lemmy_community"
```

#### 4.2.1 Feed List

**Mainstream Environment & Policy**

| Name | URL | Format | feedType | Notes |
|------|-----|--------|----------|-------|
| Yale Environment 360 | e360.yale.edu/feed.xml | rss | article | Rigorous science journalism |
| Grist | grist.org/feed | rss | article | Solutions-focused, high alignment |
| Inside Climate News | insideclimatenews.org/feed/ | rss | article | Investigative, US policy focus |
| Carbon Brief | carbonbrief.org/feed | rss | article | Data-heavy policy coverage |
| Mongabay | mongabay.com/feed | rss | article | Biodiversity and forests |
| Climate Home News | climatechangenews.com/feed/ | rss | article | Global diplomacy focus |
| Dialogue Earth | dialogue.earth/en/feed/ | rss | article | Global South perspectives; Asia/Africa |
| The Guardian – Environment | theguardian.com/environment/rss | rss | article | High volume; aggressive filtering needed |

**Green Tech**

| Name | URL | Format | feedType | Notes |
|------|-----|--------|----------|-------|
| CleanTechnica | cleantechnica.com/feed/ | rss | article | EV, solar, wind |
| Electrek | electrek.co/feed/ | rss | article | EV and clean energy |
| Canary Media | canarymedia.com/feed/ | rss | article | Climate solutions journalism |
| PV Magazine | pv-magazine.com/feed/ | rss | article | Solar industry |

**Solarpunk, Culture & Deep Ecology**

| Name | URL | Format | feedType | Notes |
|------|-----|--------|----------|-------|
| Solarpunk Magazine | solarpunkmagazine.com/feed/ | rss | culture | Fiction and essays |
| Low-Tech Magazine | solar.lowtechmagazine.com/feeds/ | rss | article | Solar-powered server; foundational solarpunk resource |
| Atmos Magazine | atmos.earth/feed/ | rss | culture | Climate × culture intersection |
| Orion Magazine | orionmagazine.org/feed/ | rss | culture | Nature, culture, place |
| Emergence Magazine | emergencemagazine.org/feed/ | rss | culture | Literary ecology |
| Reasons to be Cheerful | reasonstobecheerful.world/feed/ | rss | article | Solutions journalism |
| Resilience.org | resilience.org/feed/ | rss | article | Post Carbon Institute; community resilience |

**Community & Mutual Aid**

| Name | URL | Format | feedType | Notes |
|------|-----|--------|----------|-------|
| Shareable | shareable.net/feed/ | rss | article | Mutual aid, sharing economy, tool libraries |

**Newsletters / Substacks** *(ingest-only; excluded from generation)*

| Name | URL | Notes |
|------|-----|-------|
| Heated (Emily Atkin) | heated.world/feed | Climate accountability |
| The Crucial Years (Bill McKibben) | billmckibben.substack.com/feed | Climate strategy |

> Substack feeds: append `/feed` to any Substack URL. For newsletters without RSS, use Kill the Newsletter! to generate a private RSS feed from an email subscription. See §5.3.

**Reddit** *(reuses `src/ingest/reddit.ts` unchanged)*

| Subreddit | feedType | Notes |
|-----------|----------|-------|
| r/solarpunk | subreddit | Core community |
| r/sustainability | subreddit | Broad sustainability |
| r/environment | subreddit | News and discussion |
| r/zerowaste | subreddit | Practical lifestyle |
| r/climate | subreddit | Science and policy |
| r/ClimateActionPlan | subreddit | Activism |
| r/Permaculture | subreddit | Land stewardship |

**Social / Decentralized** *(new ingest modules; see §4.10)*

| Source | Format | Tag/Community | Notes |
|--------|--------|---------------|-------|
| mastodon.social | mastodon_hashtag | #solarpunk | No auth required |
| mastodon.social | mastodon_hashtag | #mutualaid | No auth required |
| mastodon.social | mastodon_hashtag | #permaculture | No auth required |
| slrpnk.net | mastodon_hashtag | #solarpunk | Dedicated solarpunk Mastodon instance |
| Bluesky | bluesky_hashtag | #solarpunk | Public search API; no auth |
| Bluesky | bluesky_hashtag | #climateaction | Public search API; no auth |
| slrpnk.net (Lemmy) | lemmy_community | solarpunk | Solarpunk link aggregator |

---

### 4.3 `src/prompts/evaluate-news.ts`

Replace `EVALUATE_NEWS_PROMPT` entirely. The prompt now includes an explicit **hard doom-loop rejection rule**:

```
Analyze the provided content and determine whether it is relevant to a sustainability
and solarpunk newsletter.

## What IS relevant:
- Climate science findings, IPCC updates, and environmental research
- Clean energy technology — solar, wind, grid storage, EVs, heat pumps
- Sustainability policy, legislation, international agreements, and grassroots activism
- Regenerative agriculture, biodiversity, land use, and ocean health
- Solarpunk culture: fiction, art, community projects, and mutual aid
- Environmental films, documentaries, TV shows, music, and books
- Green tech startups, circular economy, and sustainable materials
- Local resilience projects — urban farming, repair cafes, community energy
- Indigenous knowledge systems, traditional ecological knowledge
- Citizen science projects and open-source ecology hardware
- Community resilience reports from NGOs and environmental justice organizations
- Whitepapers from post-carbon or transition organizations (Post Carbon Institute, etc.)

## What is NOT relevant:
- Fossil fuel company press releases with no critical framing
- Generic greenwashing marketing with no substantive content
- Job postings
- Tech news unrelated to sustainability or clean energy
- Content shorter than a few substantive paragraphs
- Listicles with no editorial depth or analysis

## Doom Loop Scoring:
Assign a `hope_score` from 1–10 indicating how much this content presents agency,
solutions, or paths forward:
- 1–2: Pure catastrophe framing, no human agency or response visible
- 3–5: Problem-heavy with token gestures toward action
- 6–8: Balanced — names the problem clearly, shows responses or alternatives
- 9–10: Primarily solution-focused, community-centered, or action-oriented

HARD REJECTION: content with `hope_score` of 1 or 2 is automatically rejected
regardless of topical relevance. Do not pass it to the selection stage.

The presence of a single "but we can still try" phrase does not raise a 1–2 score.
Evaluate based on the dominant message and structural emphasis of the piece.

Output JSON:
{
  "chainOfThought": "...",
  "is_relevant_content": true/false,
  "hope_score": 1-10
}
```

---

### 4.4 `src/prompts/evaluate-research.ts`

Replace the research scoring rubric. Criteria for relevance (1-10, threshold 6):

- **Novelty**: Is the finding new or does it substantially update existing understanding?
- **Climate/ecology relevance**: Does it bear on climate change, biodiversity, land/ocean systems, or community resilience?
- **Policy or practical implications**: Can it inform policy, practice, or community decision-making?
- **Accessibility**: Can a non-specialist reader understand the significance?

Source types now in scope (expanded from academic-only):
- Peer-reviewed journals (Nature, Science, PNAS, AGU journals, PLOS)
- Environmental preprints: ESSOAr, EcoEvoRxiv, bioRxiv ecology category
- Reports from recognized environmental NGOs and research institutes
- Open-source hardware/ecology project documentation with scientific backing
- Citizen science datasets with academic co-authorship or institutional endorsement

---

### 4.5 `src/ingest/feeds.ts` — Replace `fetchArxivPapers`

Rename to `fetchEnvironmentPreprints` and replace the arXiv query.

**Primary source: ESSOAr API**
```
https://essopenarchive.org/api/ojs/preprints?searchQuery=climate+OR+ecology&limit=20
```

**Fallback: arXiv with environmental categories**
```
cat:physics.ao-ph OR cat:physics.geo-ph OR cat:q-bio.PE OR cat:q-bio.QM
```

**Secondary: bioRxiv API** (ecology category)
```
https://api.biorxiv.org/details/biorxiv/ecology/YYYY-MM-DD/YYYY-MM-DD/json
```

> **Date range helper required:** bioRxiv requires explicit start/end dates in the URL — unlike arXiv which accepts a static query. `fetchEnvironmentPreprints` must calculate `today - 7 days` at call time and format both dates as `YYYY-MM-DD` to build the request URL dynamically. Hardcoding dates will silently return stale or empty results.

The function signature changes from `fetchArxivPapers(maxResults)` to `fetchEnvironmentPreprints(maxResults)`. Update all callers.

---

### 4.6 `src/ingest/evaluate.ts` — `detectContentType`

Add `"culture"` as a content type. Extended heuristic table:

| Signal | Detected type |
|--------|--------------|
| URL contains arxiv.org / essoar.org / ecoevoarchive.org / biorxiv.org | `research` |
| URL contains github.com / instructables.com / show_hn | `project` |
| URL contains imdb.com / rottentomatoes.com / bandcamp.com / pitchfork.com | `culture` |
| URL contains solarpunkmagazine.com / atmos.earth / orionmagazine.org | `culture` |
| Feed `category` field is `"culture"` | `culture` |
| Source is a Mastodon/Bluesky social item (new `origin` field) | `social` |
| Default | `news` |

Culture items route to `evaluate-culture.ts`. Social items route to `evaluate-social.ts` (§4.8).

---

### 4.7 New: `src/prompts/evaluate-culture.ts`

```
Evaluate whether this content qualifies as culture content for a sustainability
and solarpunk newsletter.

## What IS relevant culture content:
- Films or documentaries with environmental, ecological, or solarpunk themes
- TV series that meaningfully engage with climate, sustainability, or solarpunk futures
- Music artists, albums, or songs with environmental themes or activist intent
- Fiction books, short stories, or poetry in solarpunk, cli-fi, or ecological genre
- Visual art, installations, or exhibitions about ecology or climate futures
- Video games with sustainability, solarpunk, or ecological themes
- Theater, performance art, or public installations on environmental themes

## What is NOT relevant:
- Celebrity profiles that mention the environment incidentally
- Listicles with no editorial depth
- Content under a few substantive paragraphs
- Reviews that only mention "nature visuals" without substantive thematic engagement

Output JSON: { "chainOfThought": "...", "is_relevant_content": true/false }
```

---

### 4.8 New: `src/prompts/evaluate-social.ts`

Social posts (Mastodon, Bluesky, Lemmy) require a different evaluator. They are shorter and typically link out. The evaluator determines whether the linked URL is worth scraping, or whether the post itself (for text-only posts) contains useful signal.

```
You are evaluating a short social media post (Mastodon, Bluesky, or Lemmy) for a
sustainability and solarpunk newsletter.

## Evaluate each post on two independent dimensions:

**Dimension 1 — External URL:**
Does the post contain an external URL worth scraping?
- Yes: set scrape_url: true, url: "<the url>"
- No: set scrape_url: false

**Dimension 2 — Original Commentary:**
Does the post itself contain substantive original text — a personal project update,
a local activism report, a community resource, or meaningful original analysis of
a linked article?
- Yes: set keep_as_signal: true, summary: "<1-2 sentence summary of the signal>"
- No: set keep_as_signal: false

Both dimensions can be true simultaneously. A post that links to an article AND
contains a detailed personal critique of it should have scrape_url: true AND
keep_as_signal: true. The pipeline will scrape the URL and prepend the post
author's commentary as community context before passing to evaluation.

## Always output all four fields:
{
  "scrape_url": true/false,
  "url": "<url or empty string>",
  "keep_as_signal": true/false,
  "summary": "<summary or empty string>"
}

## Reject (set both to false) if:
- It is purely a repost or quote-post with no original commentary
- The linked URL is a social profile page, not an article or resource
- The post is a reply fragment with no standalone context
- The post text is fewer than 2 substantive sentences
```

New module: `src/ingest/evaluate-social.ts` to handle this branching logic.

**Pipeline hydration note:** When `scrape_url: true` AND `keep_as_signal: true`, the pipeline must maintain a link between the social post metadata (author handle, instance, summary) and the scraped article throughout the ingest chain. A new `social_origin` field on the stored content item carries this forward to `assemble.ts` for attribution rendering. See §4.16 for assembly details.

---

### 4.9 `src/prompts/select-stories.ts`

Replace both constants.

**System prompt:**
> You are a journalist and editor for a weekly sustainability and solarpunk newsletter. You select stories that inform, inspire, and connect readers to action. You trust your readers to care. You never catastrophize. Always respond with valid JSON.

**Selection rules:**

1. **Pillar Coverage (strong preference, not hard rejection)**: Strongly prefer selections that span at least 3 of the 4 pillars (Green Tech, Policy/Activism, Culture, Community). If 3-pillar coverage is achievable with strong stories, require it. If the only way to reach 3 pillars is to select a weak or marginally relevant story, it is acceptable to run 2 stories from one pillar provided both are genuinely strong. Explain your reasoning in `chain_of_thought`.
2. **Solutions Bias**: At least 2 stories must be solution-oriented — they show people, communities, or systems doing something, not just describing a problem.
3. **Culture Required**: At least 1 story MUST come from the Culture pillar.
4. **No Doom Loop**: Any story with `is_doom_loop: true` (flagged at evaluate stage) must not appear. Do not override this.
5. **Source Diversity**: Maximum 1 story per publication or domain.
6. **Geographic Diversity**: At least 1 story from outside the US/UK when possible. Strongly prefer Global South coverage when relevant.
7. **Recency**: News and policy stories within 7 days. Culture features within 30 days. Community stories within 14 days.
8. **Prefer Specificity**: Choose a story about a specific community garden over a generic "urban farming is growing" trend piece.

---

### 4.10 New: Social Media Ingest Modules

These are **new source types** with no equivalent in the AINewsletter codebase. Each becomes a new file under `src/ingest/`.

#### 4.10.1 `src/ingest/mastodon.ts`

Mastodon's public hashtag timeline requires no authentication for federated instances — but unauthenticated calls to large instances like `mastodon.social` are aggressively rate-limited and may return cached/stale results.

**Recommendation: generate a read-only access token for each instance you query.** Even though no user data is accessed, a token reliably bypasses cached public responses and avoids 429 errors during the automated weekly cron. Set `MASTODON_ACCESS_TOKEN_MASTODON_SOCIAL` and `MASTODON_ACCESS_TOKEN_SLRPNK_NET` as separate env vars — each instance issues its own token.

**API endpoint:**
```
GET https://{instance}/api/v1/timelines/tag/{hashtag}?limit=40
Authorization: Bearer {token}    ← include if token available; omit if not
```

**Instances to query:**
- `mastodon.social` — general; largest Mastodon instance
- `slrpnk.net` — dedicated solarpunk Mastodon instance (highest signal)
- `kolektiva.social` — activism-focused instance

**Hashtags to monitor:** `#solarpunk`, `#mutualaid`, `#permaculture`, `#righttorepair`, `#climateaction`, `#zerowaste`

**Post structure returned:**
```typescript
interface MastodonPost {
  id: string;
  created_at: string;          // ISO 8601
  content: string;             // HTML; strip tags for text
  url: string;                 // canonical URL of the post
  card?: {                     // link preview if present
    url: string;
    title: string;
    description: string;
  };
  reblogs_count: number;
  favourites_count: number;
  account: { acct: string; display_name: string };
}
```

**Pipeline integration:**
1. Fetch posts from each instance/hashtag pair
2. Deduplicate by URL
3. Pass each post to `evaluate-social.ts`
4. If `scrape_url: true`, add the linked URL to the standard scrape queue
5. If `keep_as_signal: true`, store the post text directly as a lightweight content item (no scraping needed)
6. Filter to posts with `reblogs_count + favourites_count >= 5` to reduce noise

**Config addition to `feeds.json`:**
```json
{
  "name": "Mastodon #solarpunk (slrpnk.net)",
  "sourceName": "slrpnk.net",
  "feedType": "article",
  "feedUrl": "https://slrpnk.net/api/v1/timelines/tag/solarpunk",
  "format": "mastodon_hashtag",
  "category": "community",
  "enabled": true
}
```

**New environment variables:**
```
MASTODON_ACCESS_TOKEN=          # Optional; required only if querying private instances
```

---

#### 4.10.2 `src/ingest/bluesky.ts`

Bluesky's AT Protocol exposes a **public search API** — no authentication required for read-only hashtag searches.

**API endpoint:**
```
GET https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=%23solarpunk&limit=25
```

**Post structure:**
```typescript
interface BlueskyPost {
  uri: string;                    // at:// URI
  cid: string;
  author: { handle: string; displayName: string };
  record: {
    text: string;
    createdAt: string;
    embed?: {                      // attached link card
      external?: { uri: string; title: string; description: string };
    };
  };
  likeCount: number;
  repostCount: number;
  indexedAt: string;
}
```

**Hashtags to search:** `#solarpunk`, `#climateaction`, `#permaculture`, `#sustainability`, `#solarpunkaesthetic`

**Pipeline integration:** Same pattern as Mastodon — evaluate-social → scrape queue or signal store.

**Engagement filter:** `likeCount + repostCount >= 3`

**New environment variables:** None for read-only public search.

---

#### 4.10.3 `src/ingest/lemmy.ts`

slrpnk.net is a Lemmy instance dedicated to the solarpunk community. Lemmy's API is REST and publicly accessible.

**Federation caveat:** Lemmy federates communities across instances, but a federated copy may lag behind or be incomplete. Always query the **home instance of the community directly** rather than relying on `slrpnk.net` to have a fully synced copy of communities hosted elsewhere.

| Community | Home instance | API endpoint |
|-----------|--------------|-------------|
| !solarpunk | slrpnk.net | `https://slrpnk.net/api/v3/post/list?community_name=solarpunk&sort=Hot&limit=20` |
| !sustainability | slrpnk.net | `https://slrpnk.net/api/v3/post/list?community_name=sustainability&sort=Hot&limit=20` |
| !ecology | slrpnk.net | `https://slrpnk.net/api/v3/post/list?community_name=ecology&sort=Hot&limit=20` |
| !zerowaste | lemmy.ml | `https://lemmy.ml/api/v3/post/list?community_name=zerowaste&sort=Hot&limit=20` |

**Post structure:**
```typescript
interface LemmyPost {
  post: {
    id: number;
    name: string;                  // title
    url?: string;                  // external link (if link post)
    body?: string;                 // text content (if text post)
    published: string;             // ISO 8601
    ap_id: string;                 // canonical URL of the post
  };
  counts: { score: number; comments: number };
}
```

**Pipeline integration:** Same as Mastodon/Bluesky. Link posts → scrape queue. Text posts → signal store if score >= 10.

---

#### 4.10.4 Threads (Meta) — Limitation Note

The **Threads API** (as of 2026) is a **publishing-only API**. It does not support reading public post feeds or hashtag searches by third parties. Options:

- **Not implemented in v1.** Monitor the API roadmap.
- Alternative: manually curate 3-5 key Threads accounts and add their profile pages as `scraped_page` feeds if Firecrawl can render them.

---

#### 4.10.5 Instagram — Limitation Note

The **Instagram Graph API** requires an approved business account and only returns content from accounts you control. There is no public hashtag search available to third-party apps without a Meta app review.

Options:
- **Not implemented in v1** for automated monitoring.
- Workaround: Identify 5-10 key Instagram sustainability accounts and add their public URLs as `scraped_page` feeds — Firecrawl can scrape public profile grids.
- Future: If Meta opens hashtag search via the Threads API expansion, revisit.

---

### 4.11 `src/prompts/write-section.ts`

Replace both `WRITE_SECTION_SYSTEM` and `WRITE_SECTION_INSTRUCTIONS`.

**System prompt:**
> You are a writer for a weekly sustainability and solarpunk newsletter called Solarpunk Currents. Your voice is warm, grounded, and hopeful — not preachy, not corporate, not doom-filled. You trust readers to care. Always respond with valid JSON.

**Audience:**
- People already engaged with sustainability who want intelligent curation
- Design and culture creatives interested in solarpunk aesthetics and alternative futures
- Policy-aware readers who follow climate legislation and want the "so what"
- People living sustainably who want community validation and discovery

**Section structure — standard stories:**

1. **The Story** — 1-2 sentences. What happened. Plain language.
2. **Why It Matters** — 3-4 bullets. Real-world significance. No jargon. Human-scale examples preferred over statistics.
3. **The Bigger Picture** — 1-2 sentences. Connects to longer arc of change, not just this week's news.
4. **Take Action / Go Deeper** — 1 optional item. A link, resource, or concrete action. Omit if nothing strong is available.

**Section structure — Culture stories:**

1. **The Work** — What it is, who made it, where it came from.
2. **The Themes** — 2-3 bullets. What environmental or solarpunk ideas does it engage, and how?
3. **Worth Your Time?** — Direct recommendation: yes/no and 1-2 sentences why.
4. **Where to Find It** — Platform, streaming service, or purchase link.

**Tone rules:**
- Warm, hopeful, grounded
- Short sentences — 15 words max (carry over from AINewsletter)
- No doom-and-gloom framing
- No corporate sustainability speak
- No greenwashing amplification
- Prefer specific human-scale examples: "a school in Nairobi" over "communities across the Global South"

**Word Blacklist** — never use these:
> Disruption, Leverage, Synergy, Unprecedented, Apocalypse, End-of-the-world, Corporate, Stakeholder, Revolutionary, Game-changing, Paradigm shift, Sustainable future (too vague), ESG, Net-zero commitment (without critical framing), Consumers (use *people*, *communities*, or *citizens*), Human capital, Thought leader

**Preferred Vocabulary** — reach for these when natural:
> Resilience, Regeneration, Symbiosis, Ancestors, Heirloom, Circular, Grassroots, Stewardship, Commons, Mutual aid, Thriving, Deep roots, Living systems

---

### 4.12 `src/prompts/write-intro.ts`

Replace intro prompt. Structure:

1. Open with a brief observation from the natural world or a seasonal note (1 sentence)
2. 1-sentence setup: what this week's newsletter covers, broadly
3. 4 story teasers — one sentence each, ordered: Tech → Policy → Culture → Community
4. 1-sentence closing hook: why this particular combination of stories matters this week

No productivity framing, no ROI language, no "here's what you need to know to stay ahead."

---

### 4.13 `src/prompts/subject-line.ts`

Replace subject line prompt:
- 6-9 words
- Culture and activism stories make the best subject lines — lead with these when strong
- Never use fear-based framing
- Style: curious, specific, inviting
- Examples: *"A solar novel, a reef victory, a local grid"* / *"The documentary everyone's watching this week"*

---

### 4.14 `src/generate/ai-discoveries.ts` → `src/generate/green-pulse.ts`

Rename and retune. Same pattern: Tavily searches → Claude curation → 3 items from different domains.

**New search queries:**
```
"climate breakthrough renewable energy this week"
"environmental activism victory campaign [current year]"
"solarpunk community project local news"
"circular economy innovation new project"
"biodiversity conservation success story"
```

**New curation rules:**
- 3 stories from 3 different domains
- Must cover at least 2 different pillars
- No culture content (that goes in §4.15)
- Doom-loop items rejected

**Output format:** `## 🌱 Green Pulse`

---

### 4.15 `src/generate/ai-for-good.ts` → `src/generate/culture-picks.ts`

Rename and retune. Becomes the **Culture Picks** section: 3 films, shows, albums, or books.

**New search queries:**
```
"new documentary climate environment film festival [current year]"
"solarpunk film movie TV show streaming new"
"environmental music album artist new release"
"cli-fi solarpunk climate fiction book new"
"ecological art installation exhibition new"
```

**Output format:** `## 🎬 Culture Picks` — each item: title, type (film/show/album/book/game), platform/where to find it, 1-sentence hook.

---

### 4.16 `src/generate/assemble.ts`

Update section order, labels, and include social signal attribution:

```
1. Subject line
2. Pre-header teaser ("PLUS:" — same format as AINewsletter)
3. Intro
4. Story sections (4):
   - Green Tech story
   - Policy/Activism story
   - Culture story
   - Community/Local story
5. Green Pulse — 3 quick items (§4.14)
6. Culture Picks — 3 media recommendations (§4.15)
7. Footer
```

Social-sourced items should include a `via @handle (Mastodon/Bluesky)` attribution in the section footer, similar to how the current newsletter credits sources.

---

## 5. New Source Modules & Strategies

### 5.1 Preprint Sources

Replace `fetchArxivPapers` with `fetchEnvironmentPreprints` in `src/ingest/feeds.ts`.

**ESSOAr** (primary):
```
https://essopenarchive.org/api/ojs/preprints?searchQuery=climate&limit=20
```

**bioRxiv ecology** (secondary):
```
https://api.biorxiv.org/details/biorxiv/ecology/{start_date}/{end_date}/json
```

**arXiv fallback** (keep existing parser, change query):
```
cat:physics.ao-ph OR cat:physics.geo-ph OR cat:q-bio.PE
```

### 5.2 Lemmy / Fediverse Discovery

Beyond slrpnk.net, monitor these Lemmy communities for link posts:

| Community | Instance | Topics |
|-----------|----------|--------|
| !solarpunk@slrpnk.net | slrpnk.net | Core solarpunk |
| !sustainability@slrpnk.net | slrpnk.net | Practical sustainability |
| !ecology@slrpnk.net | slrpnk.net | Environmental science |
| !zerowaste@lemmy.ml | lemmy.ml | Waste reduction |

### 5.3 Newsletter Aggregation Without RSS

For newsletters that lack RSS (or have paywalled RSS):

- **Kill the Newsletter!** (kill-the-newsletter.com) — generates a private Atom feed from an email subscription address. Use this to ingest email-only newsletters into the standard feed pipeline.
- This is a manual setup step, not automated infrastructure. Document in `EMAIL_SETUP.md` equivalent.

### 5.4 Custom Scraped Pages

Some high-value sources have no RSS. Add as `scraped_page` feeds in `feeds.json`:

| Source | URL | `articlePathPrefix` |
|--------|-----|---------------------|
| Low-Tech Magazine (additional content) | lowtechmagazine.com | `/posts/` |
| Instructables – Outside | instructables.com/outside | `/id/` |
| Shareable (if RSS breaks) | shareable.net | `/p/` |

### 5.5 URL Pre-flight: Un-shortener and Paywall Check

Social posts frequently contain shortened URLs (`bit.ly`, `t.co`, `tinyurl.com`) and links to paywalled content. Sending these directly to Firecrawl wastes API credits and may silently ingest login walls as article content.

Add a lightweight `src/ingest/url-preflight.ts` module that runs **before** Firecrawl on any URL sourced from social ingestion:

```typescript
// Pseudo-code — not final implementation
async function preflightUrl(url: string): Promise<PreflightResult> {
  // 1. Un-shorten: follow redirects with HEAD request (no body download)
  const resolved = await resolveRedirects(url);   // max 5 hops, 5s timeout

  // 2. Paywall check: compare resolved domain against known paywall list
  const PAYWALL_DOMAINS = [
    "nytimes.com", "wsj.com", "ft.com", "bloomberg.com",
    "theathletic.com", "thetimes.co.uk"
  ];
  const isPaywalled = PAYWALL_DOMAINS.some(d => resolved.includes(d));

  // 3. Social profile check: reject bare profile URLs
  const SOCIAL_PROFILE_PATTERNS = [
    /instagram\.com\/[^/]+\/?$/,
    /twitter\.com\/[^/]+\/?$/,
    /bsky\.app\/profile\/[^/]+\/?$/,
  ];
  const isSocialProfile = SOCIAL_PROFILE_PATTERNS.some(p => p.test(resolved));

  return { resolvedUrl: resolved, isPaywalled, isSocialProfile, skip: isPaywalled || isSocialProfile };
}
```

RSS-sourced URLs do not need pre-flight — they come from known, vetted sources. Only social-originated URLs require this check.

---

## 6. New Environment Variables

```
# Social ingest — Mastodon tokens (per-instance, optional but strongly recommended)
MASTODON_ACCESS_TOKEN_MASTODON_SOCIAL=
MASTODON_ACCESS_TOKEN_SLRPNK_NET=
MASTODON_ACCESS_TOKEN_KOLEKTIVA_SOCIAL=

# Social engagement thresholds (tunable without code deploys)
MASTODON_MIN_ENGAGEMENT=5
BLUESKY_MIN_ENGAGEMENT=3
LEMMY_MIN_SCORE=10

# Newsletter identity
NEWSLETTER_NAME="Solarpunk Currents"
NEWSLETTER_FROM_EMAIL="hello@solarpunkcurrents.com"

# Preprint API
ESSOAR_API_KEY=               # Optional; increases rate limits
```

No Bluesky credentials needed for public search. No Lemmy credentials needed for public read.

---

## 7. Updated `src/ingest/feeds.ts` Schema Changes

```typescript
// Extend FeedDefinition.format
format: "rss" | "json" | "scraped_page" | "mastodon_hashtag" | "bluesky_hashtag" | "lemmy_community"

// Extend FeedDefinition.category
category: "newsletter" | "json" | "reddit" | "blog" | "news" | "substack" |
          "tutorial" | "research" | "culture" | "policy" | "community"

// Extend FeedDefinition.feedType
feedType: "newsletter" | "article" | "subreddit" | "tutorial" | "research" | "culture"

// New optional fields
mastodonInstance?: string    // e.g. "slrpnk.net" — for mastodon_hashtag format
hashtag?: string             // e.g. "solarpunk" — for mastodon_hashtag and bluesky_hashtag
lemmyCommunity?: string      // e.g. "solarpunk@slrpnk.net" — for lemmy_community format
```

**Schema migration note:** The `FeedDefinition` Zod schema changes are additive (new optional fields, new enum values) so existing validated items won't break. However, the **metadata serializer** in `src/storage/` needs to be updated to handle two new fields that will appear on social-sourced content items:

```typescript
// Add to stored content metadata
social_origin?: {
  platform: "mastodon" | "bluesky" | "lemmy";
  author_handle: string;       // e.g. "@alice@slrpnk.net"
  post_url: string;            // canonical URL of the social post
  commentary?: string;         // original post text if keep_as_signal: true
};
pillar?: "green-tech" | "policy" | "culture" | "community";   // set during selection
hope_score?: number;           // 1-10 from evaluate-news.ts
```

**Cache clearing:** After deploying the schema changes, clear the KV cache and any existing S3 items from the old format. The `normalize.ts` phase will throw `ZodError` on old-format cached items if the new schema is strict. Either run with a fresh date range or add a migration pass that strips unknown fields before validation.

---

## 8. Source Verification Checklist

Before building `feeds.json`, verify for each candidate source:

- [ ] RSS/JSON feed URL is live and publicly accessible (no auth required)
- [ ] Feed update frequency (weekly or faster is required)
- [ ] Articles are full-text or summary-only (affects scrape necessity)
- [ ] Mastodon instances: confirm public hashtag timeline is enabled
- [ ] ESSOAr API: confirm endpoint schema and rate limits
- [ ] bioRxiv API: confirm ecology category date-range query format
- [ ] slrpnk.net: confirm Lemmy API version (v3 expected)

**Priority verification before implementation:**
Solarpunk Magazine, Low-Tech Magazine, ESSOAr API, slrpnk.net API, Atmos Magazine.

**Shadow Ingest (pre-implementation validation):** Before fully committing to the new pipeline, run 3 days of ingest using the new `feeds.json` but with the **old AI relevance evaluator** still in place. This reveals raw content volume without yet filtering for topic. Target: ≥50 items/day reaching the scrape stage. If volume is below that, loosen `MASTODON_MIN_ENGAGEMENT` / `BLUESKY_MIN_ENGAGEMENT` thresholds before switching evaluators.

---

## 9. Implementation Order

**Phase 0 — Validation (before any code changes)**
1. Run **shadow ingest** (see §8): new `feeds.json`, old AI evaluator, 3 days. Confirm ≥50 items/day.
2. Tune engagement thresholds in `.env` if volume is low.

**Phase 1 — Ingest layer**
3. **`feeds.ts`** — extend `FeedDefinition` Zod schema (new format/category/feedType enums, new optional fields).
4. **`feeds.json`** — build verified feed list. Run `npm run ingest` and inspect.
5. **`mastodon.ts`** — new module. Test with slrpnk.net first (highest signal, smaller volume).
6. **`bluesky.ts`** — new module. Test with #solarpunk public search.
7. **`lemmy.ts`** — new module. Query home instances, not federated copies.
8. **`url-preflight.ts`** — new module. Wire into social ingest path before Firecrawl.

**Phase 2 — Evaluation layer**
9. **`evaluate-news.ts`** — update relevance prompt; add `hope_score` output field; wire hard rejection at `hope_score ≤ 2`.
10. **`evaluate.ts`** — add `"culture"` and `"social"` to `detectContentType`; add `social_origin` field propagation.
11. **`evaluate-culture.ts`** — new prompt file; wire into evaluation branching.
12. **`evaluate-social.ts`** — new module; implement double-pass hydration; maintain `social_origin` link.
13. **`evaluate-research.ts`** — update scoring criteria and source type list.
14. **`storage/`** — update metadata serializer to handle `social_origin`, `pillar`, `hope_score` fields.

**Phase 3 — Generation layer**
15. **`select-stories.ts`** — new selection criteria. Test on an ingested week; review pillar coverage.
16. **`write-section.ts`** — new structure, tone, blacklist/preferred vocabulary.
17. **`write-intro.ts`**, **`subject-line.ts`** — tune after section writing is confirmed.
18. **`green-pulse.ts`** — rename and retune `ai-discoveries.ts`.
19. **`culture-picks.ts`** — rename and retune `ai-for-good.ts`.
20. **`assemble.ts`** — new section order, social attribution rendering.

**Phase 4 — Image and identity**
21. **`src/utils/imageProcessor.ts`** — add `SOLARPUNK_STYLE_PRESET` (see §9.1).
22. **`src/worker/lib/headerImage.ts`**, **`storyImage.ts`** — wire preset into image generation calls.
23. **Branding** — logo asset, newsletter name strings, email from-address, Ghost tag.

### 9.1 Image Style Preset

Add to `src/utils/imageProcessor.ts`:

```typescript
export const SOLARPUNK_STYLE_PRESET =
  "Studio Ghibli aesthetic, vibrant greens and blues, lush vegetation integrated " +
  "with clean solar technology, community gardens on rooftops, warm optimistic " +
  "lighting, illustrated not photographic, 4k digital art";
```

Pass this as the base style string for any AI-generated header or story images. It replaces the implied tech/AI aesthetic from the original newsletter with a solarpunk visual language.

---

## 10. Name Evaluation: *Solarpunk Currents*

**Verdict: Strong. Recommended.**

| Dimension | Assessment |
|-----------|-----------|
| Movement alignment | "Solarpunk" in the name is unambiguous — no explaining required. Signals values immediately. |
| Metaphor depth | "Currents" works on three levels: electrical (solar power), water (ocean/river ecology), and cultural (currents of change). All three are on-brand. |
| Tone | Energetic without aggression. Optimistic without naivety. |
| Memorability | Two words, easy to say aloud, distinctive from existing publications. |
| Searchability | "Solarpunk" is a well-indexed keyword. "Currents" differentiates from *Solarpunk Magazine* already in the space. |
| One concern | The explicit "solarpunk" label may narrow reach for sustainability readers who don't identify with the aesthetic movement. Counter: clarity of audience is a feature for a niche newsletter, not a bug. |

**Package/code name:** `solarpunk-currents`

---

## 11. Resolved Decisions (v2.0 review)

All open questions from §10 are now resolved:

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Publishing platform | **Ghost** (reuse existing `src/ghost/` integration) | Already implemented; open-source aligns with solarpunk values better than VC-backed Substack/Beehiiv |
| 2 | Threads/Instagram | **Skip v1** | API limitations make automation impractical; higher-signal community content available via Mastodon/Bluesky/Lemmy |
| 3 | Engagement thresholds | **Environment variables** (`MASTODON_MIN_ENGAGEMENT`, `BLUESKY_MIN_ENGAGEMENT`, `LEMMY_MIN_SCORE`); tune after shadow ingest | Avoids redeployment for threshold tuning |
| 4 | Social attribution | **Yes** — include `via @handle (instance)` in section footer | Builds community goodwill; signals the newsletter is embedded in the culture, not scraping from outside |
| 5 | Kill the Newsletter! | Manual setup by newsletter operator; document in `EMAIL_SETUP.md` | Not automated infrastructure |

---

## 12. Cron / Cadence Architecture

**Question from review:** Does the weekly cadence affect the worker's cron schedule, or does the ingest run daily and aggregate the "best of" at the end of the week?

**Answer: Daily ingest, weekly generation.**

```
Daily (automated via Cloudflare Worker cron):
  ├── Fetch all RSS/JSON/Reddit/Social feeds
  ├── Scrape new URLs (Firecrawl)
  ├── Evaluate relevance + hope_score (Mistral)
  └── Store to S3/R2 partitioned by date

Weekly (triggered manually or on a fixed day — e.g. Thursday):
  ├── Load all items ingested since last generation run
  ├── Select top 4 stories across the full week's pool (Kimi K2)
  ├── Generate subject line (Kimi K2)
  ├── Write sections (Claude)
  ├── Run green-pulse.ts and culture-picks.ts searches
  ├── Assemble markdown
  └── Publish to Ghost + send via Resend
```

**Why daily ingest matters for a weekly newsletter:** Breaking news and short-lived stories (activism victories, film release announcements, community project launches) need to be captured within 24-48 hours of publication or they disappear from feeds. Daily ingest ensures the weekly generation has a full 7-day pool to select from, not just what happened to be live on publication day.

**Worker cron change:** Update `src/worker/handlers/scheduled.ts`. The ingest cron stays on its existing daily schedule. Add a second cron trigger for weekly generation (e.g. `0 8 * * 4` — Thursday 8am) or keep generation as a manual CLI step for v1.

**Storage key change:** The weekly generation pass needs a date range (`startDate` + `endDate`) rather than a single date. Update `src/generate/index.ts` to accept a date range and load all S3 items between those dates before passing to story selection.
