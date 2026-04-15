import { chatWithMistral } from "../llm/mistral.js";
import type { ContentType } from "./types.js";
import { EVALUATE_NEWS_PROMPT } from "../prompts/evaluate-news.js";
import { EVALUATE_RESEARCH_PROMPT } from "../prompts/evaluate-research.js";

export interface EvaluationResult {
  isRelevant: boolean;
  reasoning: string;
  score?: number; // numeric score for research items (1-10)
}

// Re-export for any callers that imported the old local constant
export { EVALUATE_RESEARCH_PROMPT as RESEARCH_SCORING_PROMPT } from "../prompts/evaluate-research.js";

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
  const prompt = `${EVALUATE_RESEARCH_PROMPT}\n\n---\n${content}`;

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
  const prompt = `${EVALUATE_NEWS_PROMPT}\n${content}`;

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
