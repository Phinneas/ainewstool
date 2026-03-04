/**
 * AI Discoveries section for BrainScriblr newsletter.
 *
 * Uses Exa search to find trending AI news and discoveries from the
 * past 3 days, then uses Claude to curate exactly 3 stories from
 * completely different source domains — mirroring the research prompt:
 *
 *   "Provide a list of exactly 3 trending AI discoveries and news stories
 *   from the past 3 days. Each story must come from a completely different
 *   source website (different domain names)."
 */

import { z } from "zod/v4";
import { chatWithClaude } from "../llm/anthropic.js";
import { tavilySearch } from "../ingest/tavily-search.js";
import { log } from "../logger.js";

export interface AiDiscoveryStory {
  headline: string;
  significance: string;
  publicationDate: string;
  url: string;
  publication: string;
}

/** Search queries tuned for trending AI news and research breakthroughs. */
const SEARCH_QUERIES = [
  "trending artificial intelligence news breakthrough 2025",
  "new AI model research announcement this week",
  "AI discovery innovation technology latest",
  "machine learning deep learning new development",
];

/**
 * Run multiple Exa searches, deduplicate by URL, and return a
 * numbered candidate list for the LLM to curate.
 */
async function fetchCandidateStories(startDate: string): Promise<string> {
  const resultGroups = await Promise.all(
    SEARCH_QUERIES.map((q) => tavilySearch(q, 5, { startPublishedDate: startDate }))
  );

  const allResults = resultGroups.flat();
  const seen = new Set<string>();
  const deduped = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  log.info(`[ai-discoveries] ${deduped.length} candidate stories found`);

  return deduped
    .map(
      (r, i) =>
        `[${i + 1}]\nURL: ${r.url}\nTitle: ${r.title}\nSummary: ${(
          r.description ?? r.markdown ?? ""
        ).slice(0, 400)}\n`
    )
    .join("\n");
}

/**
 * Fetch and curate 3 trending AI discovery stories from different source domains.
 * Returns null (non-blocking) if search or curation fails.
 */
export async function fetchAiDiscoveries(
  date: string
): Promise<AiDiscoveryStory[] | null> {
  log.info("[ai-discoveries] Fetching trending AI discovery stories...");

  try {
    // Look back 3 days per the prompt spec; fall back to 7 if needed
    const startDate = new Date(
      new Date(date).getTime() - 3 * 24 * 60 * 60 * 1000
    )
      .toISOString()
      .split("T")[0];

    const candidates = await fetchCandidateStories(startDate);

    if (!candidates.trim()) {
      log.warn("[ai-discoveries] No candidate stories returned from Exa");
      return null;
    }

    const prompt = `Today is ${date}.

You are curating a section of an AI newsletter covering the latest trending AI discoveries and news.

Below is a list of recent articles found via web search. From these, select EXACTLY 3 stories that represent the most significant and trending AI developments from the past 3 days.

CRITICAL REQUIREMENTS:
1. Select exactly 3 stories.
2. Each story MUST come from a completely different source domain. Extract the domain from the URL (e.g., techcrunch.com). If two stories share a domain, discard the less relevant one.
3. Only select stories with a valid, specific URL (not a homepage).
4. Strongly prefer stories published within the last 3 days; accept up to 7 days only if fewer than 3 recent stories are available.
5. Do NOT include AI-for-good, humanitarian, or social impact stories — those belong in a separate section.

For each selected story provide:
- headline: A concise, descriptive headline
- significance: 1-2 sentences explaining why this discovery or news is significant
- publicationDate: Publication date as YYYY-MM-DD (estimate from context if not explicit)
- url: The exact URL copied verbatim from the candidate list
- publication: Name of the publication or website

CANDIDATE ARTICLES:
${candidates}

Respond with valid JSON:
{
  "chainOfThought": "List the domains of your 3 picks and confirm they are unique. Explain why each story is trending and significant.",
  "stories": [
    { "headline": "...", "significance": "...", "publicationDate": "YYYY-MM-DD", "url": "...", "publication": "..." },
    { "headline": "...", "significance": "...", "publicationDate": "YYYY-MM-DD", "url": "...", "publication": "..." },
    { "headline": "...", "significance": "...", "publicationDate": "YYYY-MM-DD", "url": "...", "publication": "..." }
  ]
}`;

    const response = await chatWithClaude({
      system:
        "You are a tech journalist curating trending AI news. Always verify that the 3 selected stories come from 3 different domains before responding. Always respond with valid JSON.",
      prompt,
      maxTokens: 2048,
    });

    const Schema = z.object({
      chainOfThought: z.string().optional(),
      stories: z
        .array(
          z.object({
            headline: z.string().min(1),
            significance: z.string().min(1),
            publicationDate: z.string(),
            url: z.string().url(),
            publication: z.string().min(1),
          })
        )
        .min(1)
        .max(3),
    });

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in LLM response");

    const parsed = Schema.safeParse(JSON.parse(jsonMatch[0]));
    if (!parsed.success) {
      log.warn("[ai-discoveries] Schema validation failed", {
        issues: parsed.error.issues,
      });
      return null;
    }

    log.info(
      `[ai-discoveries] Curated ${parsed.data.stories.length} AI discovery stories`
    );
    for (const s of parsed.data.stories) {
      log.info(`  - ${s.headline} (${s.publication})`);
    }

    return parsed.data.stories;
  } catch (error) {
    log.error("[ai-discoveries] Failed to fetch stories", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Format an array of AiDiscoveryStory objects as a newsletter markdown section.
 */
export function formatAiDiscoveriesSection(
  stories: AiDiscoveryStory[]
): string {
  const items = stories
    .map(
      (s, i) =>
        `${i + 1}. **[${s.headline}](${s.url})**\n   ${s.significance} *— ${s.publication}, ${s.publicationDate}*`
    )
    .join("\n\n");

  return `## 📡 AI Discoveries\n\n${items}`;
}
