# Exa Themed Search — Implementation Spec

## Current State (What Already Exists)

The pattern you're describing from Make.com is **already partially implemented** in two files:

- `src/generate/ai-for-good.ts` — 3 stories, humanitarian/beneficial AI theme, 7-day lookback
- `src/generate/ai-discoveries.ts` — 3 stories, trending AI news theme, 3-day lookback

Both follow the same flow:
```
4 pre-defined queries → parallel search → URL-deduplicate → LLM curates 3 stories with domain diversity
```

**The problem:** Both files say "Uses Exa search" in their comments but actually call `tavilySearch()`. Exa exists in the codebase (`src/ingest/exa-search.ts`) and is used in `discover.ts`, but has not been wired into the themed sections.

**The other problem:** Both files are ~90% identical. Every new theme requires copy-pasting the entire module. There is no shared abstraction.

---

## What Needs to Be Built

### Goal
Replace Tavily with Exa in the themed section pipeline, extract a shared abstraction, and build a theme config system so the user's remaining Make.com prompts can be added as simple config entries — no new boilerplate modules.

---

## Architecture

### 1. Shared Themed Search Engine — `src/generate/themed-search.ts`

A single generic module that powers all themed sections. A theme is defined as a plain config object:

```typescript
interface ThemeConfig {
  id: string;                  // "ai-for-good", "ai-discoveries", "ai-tools", etc.
  displayName: string;         // "AI for Good"
  emoji: string;               // "🌍"
  searchQueries: string[];     // 3-6 Exa queries tailored to the theme
  lookbackDays: number;        // How far back to search (3, 7, 14)
  storyCount: number;          // Usually 3
  systemPrompt: string;        // LLM system message persona
  curationCriteria: string;    // What to include / exclude (injected into LLM prompt)
  excludeCriteria?: string;    // What explicitly does NOT belong in this section
  excludeDomains?: string[];   // Domains to suppress (e.g., big tech blogs for niche themes)
  preferLesserKnownSources?: boolean;  // Flag to add source diversity instruction to LLM
}
```

The engine takes a `ThemeConfig` and a `date` string and returns `ThemedStory[]`:

```typescript
interface ThemedStory {
  headline: string;
  significance: string;
  publicationDate: string;
  url: string;
  publication: string;
}

async function runThemedSearch(
  theme: ThemeConfig,
  date: string
): Promise<ThemedStory[] | null>
```

This replaces the duplicated logic in both existing files.

---

### 2. Theme Definitions — `src/generate/themes/index.ts`

All themes live here as config objects. Adding a new theme = adding one config entry.

**Initial themes (migrating existing):**
- `AI_FOR_GOOD` — existing ai-for-good.ts content
- `AI_DISCOVERIES` — existing ai-discoveries.ts content

**New themes to be added** (from user's additional Make.com prompts — pending review):
- To be defined after user shares remaining prompts

**Source diversity for lesser-known sources:**

Exa supports `excludeDomains` at the API level. For themes where the goal is to surface non-mainstream sources, we can pass a list of high-traffic domains (techcrunch.com, wired.com, theverge.com, etc.) to suppress them and let smaller publishers surface. This is configurable per theme — not all themes need it.

---

### 3. Exa Integration in Themed Search

The existing `exa-search.ts` needs one addition: `startPublishedDate` support, which Exa's API natively provides but the current wrapper doesn't expose. The themed search engine calls Exa with:

```
query: theme.searchQueries[i]
numResults: 5
startPublishedDate: (date - lookbackDays)
contents: { text: { maxCharacters: 2000 } }   ← inline content, no separate scrape
excludeDomains?: theme.excludeDomains           ← optional per-theme suppression
```

Results are URL-deduplicated, formatted as a numbered candidate list, and sent to Claude for curation.

---

### 4. LLM Curation (Claude)

The existing Claude prompt structure in both files is solid and stays largely the same. The generic version injects `theme.curationCriteria` and `theme.excludeCriteria` so each theme's selection logic is data-driven:

**Fixed instructions (always present):**
1. Select exactly N stories
2. Each story must come from a different domain
3. Only use valid specific URLs (no homepages)
4. Prefer stories within the lookback window

**Variable per theme:**
- What qualifies as relevant (curationCriteria)
- What explicitly doesn't belong (excludeCriteria — used to prevent overlap between sections)
- Instruction to prefer lesser-known sources when `preferLesserKnownSources: true`

---

### 5. Section Formatting

Each theme gets a `formatSection(stories: ThemedStory[]): string` output. The current format (bold linked headline, significance sentence, italic source attribution) is good and matches the Make.com Qwen output format. This can be standardized in the shared engine with the emoji and section title coming from `ThemeConfig`.

---

## Files Affected

| File | Action |
|------|--------|
| `src/generate/themed-search.ts` | **Create** — shared engine |
| `src/generate/themes/index.ts` | **Create** — all theme configs |
| `src/ingest/exa-search.ts` | **Modify** — expose `startPublishedDate` and `excludeDomains` params |
| `src/generate/ai-for-good.ts` | **Refactor** — becomes thin wrapper calling shared engine |
| `src/generate/ai-discoveries.ts` | **Refactor** — becomes thin wrapper calling shared engine |
| `src/generate/index.ts` | **Modify** — wire in new themes as they're added |

---

## What Exa Gives You That Tavily Doesn't

| Capability | Tavily | Exa |
|---|---|---|
| Date filtering | ✅ `start_date` | ✅ `startPublishedDate` |
| Domain exclusion | ❌ | ✅ `excludeDomains` |
| Neural/semantic search | ❌ keyword-only | ✅ type: "auto" |
| Content inline | ✅ snippet | ✅ full text up to N chars |
| Already integrated | ✅ (themed sections) | ✅ (discover.ts) |
| Cost per query | ~$0.004 | ~$0.001–0.004 |

The neural search is the meaningful advantage here: a query like "AI for humanitarian causes" will return semantically relevant results even when sources don't use those exact words — better for surfacing niche and non-mainstream publishers.

---

## Source Diversity Strategy

The Make.com prompt says "each story must come from a completely different source website." The current implementation handles this at the LLM curation layer (Claude is instructed to check domains). This should stay.

For actively surfacing **lesser-known sources**, there are two levers:

1. **Exa `excludeDomains`** — suppress high-traffic domains at search time so they don't crowd the candidate pool. Used selectively for themes where non-mainstream coverage is the point.
2. **LLM instruction** — `preferLesserKnownSources: true` adds an explicit instruction to prefer independent blogs, academic sites, and niche publications over mainstream tech media when quality is equivalent.

Neither approach is binary — both can be tuned per theme.

---

## Implementation Order

1. Extend `exa-search.ts` to expose `startPublishedDate` and `excludeDomains`
2. Build `themed-search.ts` shared engine
3. Define `themes/index.ts` with the two existing themes
4. Refactor `ai-for-good.ts` and `ai-discoveries.ts` to use shared engine
5. Review remaining Make.com prompts → add as theme configs in `themes/index.ts`
6. Wire new themes into `generate/index.ts`

Steps 1–4 are a refactor with no behavior change. Step 5 is where new themes get added.

---

## Open Questions Before Implementation

1. **Remaining prompts** — What are the other Make.com prompts? Each one becomes a theme config. Share them and they'll be added to `themes/index.ts`.
2. **Domain exclusion list** — Should there be a global list of mainstream domains to exclude for certain themes, or is per-theme configuration enough?
3. **Story count** — Always 3? Or should some themes surface 5?
4. **Newsletter section ordering** — Where in the newsletter assembly do new themed sections appear? `generate/index.ts` controls this.
5. **Scheduling** — Themed search runs at newsletter generation time (Wed/Sat 8am UTC per `wrangler.toml`). That's correct — themed sections are a generate-time operation, not ingest-time.
