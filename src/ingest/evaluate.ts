import { chatWithMistral } from "../llm/mistral.js";
import type { ContentType } from "./types.js";

export interface EvaluationResult {
  isRelevant: boolean;
  reasoning: string;
  score?: number; // numeric score for research items (1-10)
}

// ---------------------------------------------------------------------------
// TASK-8: Research scoring prompt (exact text from spec)
// ---------------------------------------------------------------------------

export const RESEARCH_SCORING_PROMPT = `You are evaluating an AI research paper for a technically curious but non-academic newsletter audience.

Score this paper from 1-10 on:
- Accessibility: Can the key insight be explained in 2 sentences to a developer? (40%)
- Novelty: Does it represent a genuinely new approach or result? (35%)
- Relevance: Does it have practical implications for AI practitioners? (25%)

Return JSON: { "score": number, "headline": string, "tldr": string }
The headline should read like a newsletter headline, not an academic title.
The tldr should be 1-2 sentences a developer would find interesting.`;

// ---------------------------------------------------------------------------
// TASK-7: Content type detection via URL heuristics
// ---------------------------------------------------------------------------

export function detectContentType(item: { url: string }): ContentType {
  const url = item.url.toLowerCase();
  if (
    url.includes("arxiv.org") ||
    url.includes("semanticscholar.org") ||
    url.includes("paperswithcode.com")
  ) {
    return "research";
  }
  if (
    url.includes("github.com") ||
    url.includes("huggingface.co/spaces") ||
    url.includes("show_hn") ||
    (url.includes("news.ycombinator.com") && url.includes("item"))
  ) {
    return "project";
  }
  return "news";
}

// ---------------------------------------------------------------------------
// TASK-9: Evaluation branching by content type
// ---------------------------------------------------------------------------

export async function evaluateContentRelevance(
  content: string,
  contentType: ContentType = "news"
): Promise<EvaluationResult> {
  if (contentType === "research") {
    return evaluateResearchContent(content);
  }
  return evaluateNewsContent(content);
}

async function evaluateResearchContent(content: string): Promise<EvaluationResult> {
  const prompt = `${RESEARCH_SCORING_PROMPT}\n\n---\n${content}`;

  // Use mistral-small: faster/cheaper for structured scoring
  const response = await chatWithMistral({ prompt, maxTokens: 512, model: "mistral-small" });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { isRelevant: false, reasoning: "Failed to parse", score: 0 };

    const parsed = JSON.parse(jsonMatch[0]) as {
      score?: number;
      headline?: string;
      tldr?: string;
    };
    const score = typeof parsed.score === "number" ? parsed.score : 0;

    return {
      isRelevant: score >= 6,
      reasoning: parsed.tldr ?? parsed.headline ?? "",
      score,
    };
  } catch {
    return { isRelevant: false, reasoning: "Failed to parse LLM response", score: 0 };
  }
}

async function evaluateNewsContent(content: string): Promise<EvaluationResult> {
  const prompt = `Given content fetched from a web page, analyze this content to determine if it is a full piece of content that would be considered relevant to our AI Newsletter which features news stories, tutorials, research, and other interesting happenings in the tech and AI space.

## What IS relevant:
- AI/ML news, announcements, product launches, and industry developments
- Tutorials, guides, and how-to content about AI tools, frameworks, and techniques
- Research papers, paper summaries, and technical deep-dives on AI/ML topics
- AI policy, regulation, and societal impact analysis
- AI-adjacent technology (cloud infrastructure for AI, GPU/chip developments, developer tools)

## What is NOT relevant:
- Job postings or hiring announcements
- Content centered around industries unrelated to AI/tech
- Generic marketing content or product pages with no substantive information
- Content that is too short or thin to be useful (less than a few paragraphs)
- Listicles of AI tools with no analysis or insight

You must respond with valid JSON in this exact format:
{
  "chainOfThought": "your reasoning here",
  "is_relevant_content": true/false
}

---
${content}`;

  const response = await chatWithMistral({ prompt, maxTokens: 2048 });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { isRelevant: false, reasoning: "Failed to parse" };

    const parsed = JSON.parse(jsonMatch[0]) as {
      chainOfThought?: string;
      is_relevant_content?: boolean;
    };
    return {
      isRelevant: parsed.is_relevant_content ?? false,
      reasoning: parsed.chainOfThought ?? "",
    };
  } catch {
    return { isRelevant: false, reasoning: "Failed to parse LLM response" };
  }
}

// ---------------------------------------------------------------------------
// TASK-10: Research representation guarantee
// ---------------------------------------------------------------------------

export interface ScoredCandidate<T> {
  item: T;
  contentType: ContentType;
  evaluation: EvaluationResult;
}

/**
 * Ensure at least one research item appears in the final selection.
 * If no research items passed evaluation, force-inserts the highest-scoring
 * research candidate from the rejected list, bumping the lowest-scoring
 * non-research item.
 */
export function ensureResearchRepresentation<T>(
  passed: ScoredCandidate<T>[],
  rejected: ScoredCandidate<T>[]
): ScoredCandidate<T>[] {
  const hasResearch = passed.some((c) => c.contentType === "research");
  if (hasResearch) return passed;

  const researchCandidates = rejected
    .filter((c) => c.contentType === "research")
    .sort((a, b) => (b.evaluation.score ?? 0) - (a.evaluation.score ?? 0));

  if (researchCandidates.length === 0) return passed;

  const best = researchCandidates[0];

  // Replace the lowest-scoring non-research item, or prepend if list is empty
  if (passed.length > 0) {
    const lowestIdx = passed.reduce(
      (minIdx, c, i) =>
        (c.evaluation.score ?? 0) < (passed[minIdx].evaluation.score ?? 0) ? i : minIdx,
      0
    );
    const result = [...passed];
    result[lowestIdx] = best;
    return result;
  }

  return [best];
}
