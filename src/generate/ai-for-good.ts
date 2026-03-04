/**
 * AI for Good section for BrainScriblr newsletter.
 *
 * Uses Exa search to find recent stories about humanitarian AI, beneficial
 * AI, and human-centered AI initiatives, then uses Claude to curate exactly
 * 3 stories from completely different source domains — mirroring the prompt
 * originally used in the Make.com automation.
 *
 * Prompt logic:
 *   "Provide a list of exactly 3 trending AI news stories covering AI for
 *   humanitarian causes, beneficial AI, AI for good initiatives, and human
 *   centered AI from the past day. Each story must come from a completely
 *   different source website (different domain names)."
 */

import { z } from "zod/v4";
import { chatWithClaude } from "../llm/anthropic.js";
import { tavilySearch } from "../ingest/tavily-search.js";
import { log } from "../logger.js";

export interface AiForGoodStory {
  headline: string;
  significance: string;
  publicationDate: string;
  url: string;
  publication: string;
}

/** Search queries tuned for humanitarian / beneficial AI content. */
const SEARCH_QUERIES = [
  "AI humanitarian causes nonprofit 2025",
  "beneficial AI human-centered artificial intelligence initiative",
  "AI for good social impact health education climate",
  "artificial intelligence accessibility equity inclusion",
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

  log.info(`[ai-for-good] ${deduped.length} candidate stories found`);

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
 * Fetch and curate 3 AI-for-Good stories from different source domains.
 * Returns null (non-blocking) if search or curation fails.
 */
export async function fetchAiForGoodStories(
  date: string
): Promise<AiForGoodStory[] | null> {
  log.info("[ai-for-good] Fetching AI for Good stories...");

  try {
    // Look back 7 days so there's always enough material
    const startDate = new Date(
      new Date(date).getTime() - 7 * 24 * 60 * 60 * 1000
    )
      .toISOString()
      .split("T")[0];

    const candidates = await fetchCandidateStories(startDate);

    if (!candidates.trim()) {
      log.warn("[ai-for-good] No candidate stories returned from Exa");
      return null;
    }

    const prompt = `Today is ${date}.

You are curating a section of an AI newsletter focused on beneficial, humanitarian, and human-centered AI.

Below is a list of recent articles found via web search. From these, select EXACTLY 3 stories that best match:
- AI for humanitarian causes
- Beneficial AI
- AI for good initiatives
- Human-centered AI

CRITICAL REQUIREMENTS:
1. Select exactly 3 stories.
2. Each story MUST come from a completely different source domain. Extract the domain from the URL (e.g., techcrunch.com). If two stories share a domain, discard the less relevant one.
3. Only select stories with a valid, specific URL (not a homepage).
4. Prefer stories published within the last 7 days.

For each selected story provide:
- headline: A concise, descriptive headline
- significance: 1-2 sentences explaining why this story matters
- publicationDate: Publication date as YYYY-MM-DD (estimate from context if not explicit)
- url: The exact URL copied verbatim from the candidate list
- publication: Name of the publication or website

CANDIDATE ARTICLES:
${candidates}

Respond with valid JSON:
{
  "chainOfThought": "List the domains of your 3 picks and confirm they are unique. Explain your selection reasoning.",
  "stories": [
    { "headline": "...", "significance": "...", "publicationDate": "YYYY-MM-DD", "url": "...", "publication": "..." },
    { "headline": "...", "significance": "...", "publicationDate": "YYYY-MM-DD", "url": "...", "publication": "..." },
    { "headline": "...", "significance": "...", "publicationDate": "YYYY-MM-DD", "url": "...", "publication": "..." }
  ]
}`;

    const response = await chatWithClaude({
      system:
        "You are a journalist curating beneficial AI news. Always verify that the 3 selected stories come from 3 different domains before responding. Always respond with valid JSON.",
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
      log.warn("[ai-for-good] Schema validation failed", {
        issues: parsed.error.issues,
      });
      return null;
    }

    log.info(
      `[ai-for-good] Curated ${parsed.data.stories.length} AI-for-Good stories`
    );
    for (const s of parsed.data.stories) {
      log.info(`  - ${s.headline} (${s.publication})`);
    }

    return parsed.data.stories;
  } catch (error) {
    log.error("[ai-for-good] Failed to fetch stories", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Format an array of AiForGoodStory objects as a newsletter markdown section.
 */
export function formatAiForGoodSection(stories: AiForGoodStory[]): string {
  const items = stories
    .map(
      (s, i) =>
        `${i + 1}. **[${s.headline}](${s.url})**\n   ${s.significance} *— ${s.publication}, ${s.publicationDate}*`
    )
    .join("\n\n");

  return `## 🌍 AI for Good\n\n${items}`;
}
