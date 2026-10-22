import { chatWithMistral } from "../llm/mistral.js";
import {
  decide,
  readChoice,
  readNoul,
  readScore,
  JevPayloadTooLargeError,
  type JevQuestion,
  type JevChoiceAnswer,
} from "../llm/jev.js";
import type { ContentType } from "./types.js";
import { EVALUATE_NEWS_PROMPT } from "../prompts/evaluate-news.js";
import { EVALUATE_RESEARCH_PROMPT } from "../prompts/evaluate-research.js";

// ---------------------------------------------------------------------------
// Result + provider selection
// ---------------------------------------------------------------------------

export type EvalProvider = "mistral" | "jev";

/** Provider-neutral usage figures, for PipelineMetrics. */
export interface EvalUsage {
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
}

export interface EvaluationResult {
  isRelevant: boolean;
  /**
   * Mistral path: the model's prose rationale.
   * Jev path: a compact machine-readable summary, e.g. "noul=0.87" or
   * "tag=job_posting noul=0.04 conf=0.91". Jev produces no text at all —
   * there is no prose to return, and nothing downstream consumed it.
   */
  reasoning: string;
  score?: number; // numeric score for research items (1-10)
  probability?: number; // Jev only: the noul value behind isRelevant
  confidence?: number; // Jev only: from choice/score answers. NOT present on noul.
  rejectionTag?: string; // Jev only: structured replacement for rejection prose
  truncated?: boolean; // content exceeded the state budget and was bounded
  provider?: EvalProvider;
  usage?: EvalUsage;
}

export interface EvaluateOptions {
  provider?: EvalProvider;
  /** noul cut point. Below 0.5 on purpose — see acceptNews(). */
  threshold?: number;
  charBudget?: number;
  /** Passed through as Jev `session_id` for observability grouping. */
  sessionId?: string;
}

export interface EvalSettings {
  provider: EvalProvider;
  threshold: number;
  charBudget: number;
}

export const DEFAULT_THRESHOLD = 0.35;
export const DEFAULT_CHAR_BUDGET = 60_000;

/**
 * Resolve provider/threshold/budget from env, with overrides winning.
 *
 * Read from process.env rather than `config` because these are plain vars that
 * the Worker handler copies off its bindings at invocation time — the same
 * pattern already used for EXA/TAVILY/PARALLEL keys. Keeping the resolution
 * here means the three calling tools (Worker, CLI ingest, discovery) all get
 * identical behaviour without threading settings through every call site.
 */
export function readEvalSettings(overrides: EvaluateOptions = {}): EvalSettings {
  const provider =
    overrides.provider ??
    (process.env.EVAL_PROVIDER === "jev" ? "jev" : "mistral");

  const rawThreshold = overrides.threshold ?? Number(process.env.RELEVANCE_THRESHOLD);
  const threshold =
    Number.isFinite(rawThreshold) && rawThreshold > 0 && rawThreshold < 1
      ? rawThreshold
      : DEFAULT_THRESHOLD;

  const rawBudget = overrides.charBudget ?? Number(process.env.STATE_CHAR_BUDGET);
  const charBudget =
    Number.isFinite(rawBudget) && rawBudget >= 1000 ? rawBudget : DEFAULT_CHAR_BUDGET;

  return { provider, threshold, charBudget };
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
// State bounding
// ---------------------------------------------------------------------------

export interface BoundedState {
  text: string;
  truncated: boolean;
  originalChars: number;
}

/**
 * Bound article content before it reaches Jev.
 *
 * Jev's context is 32K tokens and it returns 413 past it; Mistral tolerated
 * unbounded input, so this path never needed a cap before. Head-only on
 * purpose: the relevance signal sits in the headline and lede, while a tail
 * window is nav, "related posts" and footer boilerplate that injects noise.
 *
 * The budget is a guess until measured. Every Jev response carries
 * usage.input_tokens, so log originalChars against it and derive the real
 * chars/token ratio — then set STATE_CHAR_BUDGET to ~85% of 32K tokens.
 */
export function boundForState(content: string, budget: number): BoundedState {
  if (content.length <= budget) {
    return { text: content, truncated: false, originalChars: content.length };
  }
  const window = content.slice(0, budget);
  // Cut at a paragraph boundary so the model never sees a half-sentence ending,
  // but only if doing so does not discard more than half the budget.
  const cut = window.lastIndexOf("\n\n");
  const text = cut > budget * 0.5 ? window.slice(0, cut) : window;
  return { text, truncated: true, originalChars: content.length };
}

// ---------------------------------------------------------------------------
// TASK-9: Evaluation branching by content type
// ---------------------------------------------------------------------------

export async function evaluateContentRelevance(
  content: string,
  contentType: ContentType = "news",
  options: EvaluateOptions = {}
): Promise<EvaluationResult> {
  const settings = readEvalSettings(options);

  if (settings.provider === "mistral") {
    const result =
      contentType === "research"
        ? await evaluateResearchContent(content)
        : await evaluateNewsContent(content);
    return { ...result, provider: "mistral" };
  }

  // Bounding is applied on the Jev path only. The Mistral path is left exactly
  // as it was so shadow mode compares like-for-like against current behaviour.
  const runAt = async (budget: number): Promise<EvaluationResult> => {
    const bounded = boundForState(content, budget);
    const result =
      contentType === "research"
        ? await evaluateResearchWithJev(bounded.text, settings, options)
        : await evaluateNewsWithJev(bounded.text, settings, options);
    return { ...result, truncated: bounded.truncated };
  };

  try {
    return await runAt(settings.charBudget);
  } catch (err) {
    if (!(err instanceof JevPayloadTooLargeError)) throw err;
    // 413 means the budget estimate was wrong, not that the article is
    // unjudgeable. Retry once at half size before giving up — silently dropping
    // the item is the worst outcome, because the handler treats a throw as
    // "skip this item" and it vanishes from the issue with no trace.
    // A second 413 propagates and is counted as an item error.
    return await runAt(Math.floor(settings.charBudget / 2));
  }
}

// ---------------------------------------------------------------------------
// Jev questions — news / project
// ---------------------------------------------------------------------------

/**
 * Ported from EVALUATE_NEWS_PROMPT. The IS/IS-NOT lists move from prompt prose
 * into `criteria`, where Jev treats them as the decision boundary rather than
 * context to reason over.
 *
 * Two things the chat prompt had that are deliberately gone:
 *  - the JSON-format block (there is no text output to format)
 *  - "be reasonably inclusive — lean toward accepting" (that sentence WAS the
 *    threshold; Jev never sees it, so the bias now lives in acceptNews())
 */
export const NEWS_QUESTIONS: Record<string, JevQuestion> = {
  is_relevant: {
    type: "noul",
    instructions:
      "Is this content worth including in a newsletter for AI/tech practitioners?",
    criteria: {
      true:
        "AI/ML news, announcements, product launches, industry developments. " +
        "Tutorials, guides and how-to content on AI tools and techniques. " +
        "Research papers, summaries and technical deep-dives. " +
        "AI policy, regulation and societal-impact analysis. " +
        "AI-adjacent infrastructure: GPU/chip developments, cloud for AI, developer tools.",
      false:
        "Pure job postings or hiring announcements. " +
        "Content unrelated to AI/tech/software. " +
        "Marketing pages with no technical content or insight. " +
        "Extremely short content (less than a paragraph). " +
        "Spam or promotional content with no informational value.",
    },
  },
  // Needs a `belongs` escape option: a choice ALWAYS picks one of the listed
  // options, so without it every accepted article gets a bogus rejection tag.
  rejection_tag: {
    type: "choice",
    instructions:
      "Which single reason best explains why this content would NOT belong in the newsletter?",
    criteria: {
      belongs: "None of these — the content does belong.",
      job_posting: "A vacancy, hiring announcement or careers page.",
      off_topic: "Not about AI, tech or software.",
      marketing_only: "A promotional page with no technical substance.",
      too_short: "Less than a paragraph of real content.",
      spam: "Spam, or promotional with no informational value.",
    },
  },
};

/**
 * Three-band accept, per the TypeSafe confidence guidance: act on high
 * confidence, proceed with caution in the middle, refuse to guess at the bottom.
 *
 * Biased below 0.5 because the two error directions are not symmetric:
 *   false accept  -> one slot in stage 5's 15-item array, which filters again
 *   false reject  -> cached as rejected in KV for 24h, gone from that issue
 * So stage 3 optimises recall and stage 5 owns precision.
 *
 * A noul answer carries NO confidence field — only choice and score do. The
 * rejection tag's confidence is the only place uncertainty is quantified here.
 */
export function acceptNews(
  noul: number,
  tag: JevChoiceAnswer | undefined,
  threshold: number
): boolean {
  if (noul >= threshold + 0.15) return true; // clear accept
  if (noul <= threshold - 0.15) return false; // clear reject
  // Uncertain band: trust a confident rejection tag, otherwise lean accept.
  if (tag && tag.choice !== "belongs" && (tag.confidence ?? 0) > 0.6) return false;
  return true;
}

async function evaluateNewsWithJev(
  content: string,
  settings: EvalSettings,
  options: EvaluateOptions
): Promise<EvaluationResult> {
  const { answers, usage } = await decide({
    state: { content },
    questions: NEWS_QUESTIONS,
    sessionId: options.sessionId,
  });

  const noul = readNoul(answers, "is_relevant");
  if (noul === undefined) {
    throw new Error("Jev returned no is_relevant answer");
  }
  const tag = readChoice(answers, "rejection_tag");
  const isRelevant = acceptNews(noul, tag, settings.threshold);

  const rejectionTag = isRelevant ? undefined : (tag?.choice ?? "unspecified");

  return {
    isRelevant,
    reasoning: [
      `noul=${noul.toFixed(3)}`,
      tag ? `tag=${tag.choice}` : null,
      tag?.confidence !== undefined ? `conf=${tag.confidence.toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join(" "),
    probability: noul,
    confidence: tag?.confidence,
    rejectionTag,
    provider: "jev",
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cost: usage.cost,
    },
  };
}

// ---------------------------------------------------------------------------
// Jev questions — research
// ---------------------------------------------------------------------------

/**
 * The rubric is 40% accessibility / 35% novelty / 25% relevance, scored 1-10,
 * accept at >= 4 (see EVALUATE_RESEARCH_PROMPT).
 *
 * Do NOT collapse that into one 10-level score question — it discards the
 * documented weighting. Instead ask three short 5-level scales in ONE request
 * (same state, so the article is only sent once) and combine them in code.
 *
 * Five levels per axis, not ten: input tokens are the only thing billed, and
 * criteria text is re-sent on every request.
 */
export const RESEARCH_QUESTIONS: Record<string, JevQuestion> = {
  accessibility: {
    type: "score",
    instructions:
      "How easily can this paper's key insight be explained in two sentences to a developer?",
    criteria: [
      "Dense theory; no plain-language summary is possible without significant background.",
      "Requires domain expertise; the insight resists a short explanation.",
      "Explainable with effort, but needs caveats or jargon.",
      "Explainable in two sentences with one term defined.",
      "Immediately explainable in two plain sentences to a developer.",
    ],
  },
  novelty: {
    type: "score",
    instructions: "How novel is this paper's approach or result?",
    criteria: [
      "Restates or re-benchmarks known results.",
      "Incremental tuning of an existing method.",
      "A useful combination of known techniques.",
      "A new method or dataset with a clear advance over prior work.",
      "A genuinely new approach or result that reframes the problem.",
    ],
  },
  relevance: {
    type: "score",
    instructions: "How directly does this paper matter to AI practitioners?",
    criteria: [
      "Purely theoretical, with no path to practice.",
      "Interesting but confined to a narrow research niche.",
      "May matter to practitioners eventually; no current application.",
      "Directly applicable to a common practitioner workflow.",
      "Immediately actionable for practitioners building with AI today.",
    ],
  },
};

const RESEARCH_WEIGHTS = { accessibility: 0.4, novelty: 0.35, relevance: 0.25 } as const;
const RESEARCH_LEVELS = 5; // criteria length; score index runs 0..4

/**
 * Combine the three weighted axes back onto the existing 1-10 scale so that
 * `score >= 4`, `score / 10` in the handler, and ensureResearchRepresentation
 * all keep working unchanged.
 */
export function combineResearchScore(axes: Record<keyof typeof RESEARCH_WEIGHTS, number>): number {
  let weighted = 0;
  for (const [key, weight] of Object.entries(RESEARCH_WEIGHTS) as [
    keyof typeof RESEARCH_WEIGHTS,
    number,
  ][]) {
    // Clamp: Jev's score is a probability-weighted position and can drift
    // fractionally outside the criteria index range.
    const normalized = Math.min(Math.max(axes[key] ?? 0, 0), RESEARCH_LEVELS - 1) / (RESEARCH_LEVELS - 1);
    weighted += weight * normalized;
  }
  // weighted is 0..1 -> map onto 1..10
  return Math.round(weighted * 9) + 1;
}

async function evaluateResearchWithJev(
  content: string,
  _settings: EvalSettings,
  options: EvaluateOptions
): Promise<EvaluationResult> {
  const { answers, usage } = await decide({
    state: { content },
    questions: RESEARCH_QUESTIONS,
    sessionId: options.sessionId,
  });

  const axes = {} as Record<keyof typeof RESEARCH_WEIGHTS, number>;
  const confidences: number[] = [];
  let missing = 0;

  for (const key of Object.keys(RESEARCH_WEIGHTS) as (keyof typeof RESEARCH_WEIGHTS)[]) {
    const answer = readScore(answers, key);
    if (answer === undefined) {
      missing++;
      axes[key] = 0;
      continue;
    }
    axes[key] = answer.score;
    if (answer.confidence !== undefined) confidences.push(answer.confidence);
  }

  if (missing === Object.keys(RESEARCH_WEIGHTS).length) {
    throw new Error("Jev returned no score answers for the research rubric");
  }

  const score = combineResearchScore(axes);
  const confidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : undefined;

  return {
    isRelevant: score >= 4,
    reasoning: [
      `score=${score}`,
      `acc=${axes.accessibility.toFixed(2)}`,
      `nov=${axes.novelty.toFixed(2)}`,
      `rel=${axes.relevance.toFixed(2)}`,
      confidence !== undefined ? `conf=${confidence.toFixed(2)}` : null,
      missing > 0 ? `missing=${missing}` : null,
    ]
      .filter(Boolean)
      .join(" "),
    score,
    confidence,
    provider: "jev",
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cost: usage.cost,
    },
  };
}

// ---------------------------------------------------------------------------
// Mistral path (unchanged) — EVAL_PROVIDER=mistral and shadow mode
// ---------------------------------------------------------------------------

function parseJson<T>(response: string): T | null {
  // Try direct parse first (JSON mode returns clean JSON), then regex extraction
  try { return JSON.parse(response) as T; } catch { /* fallthrough */ }
  try {
    const m = response.match(/\{[\s\S]*?\}/);
    if (m) return JSON.parse(m[0]) as T;
  } catch { /* fallthrough */ }
  return null;
}

async function evaluateResearchContent(content: string): Promise<EvaluationResult> {
  const prompt = `${EVALUATE_RESEARCH_PROMPT}\n\n---\n${content}`;

  const response = await chatWithMistral({ prompt, maxTokens: 512, model: "mistral-small-latest" });

  const parsed = parseJson<{ score?: number; headline?: string; tldr?: string }>(response);
  if (!parsed) return { isRelevant: false, reasoning: "Failed to parse LLM response", score: 0 };

  const score = typeof parsed.score === "number" ? parsed.score : 0;
  return {
    isRelevant: score >= 4,
    reasoning: parsed.tldr ?? parsed.headline ?? "",
    score,
  };
}

async function evaluateNewsContent(content: string): Promise<EvaluationResult> {
  const prompt = `${EVALUATE_NEWS_PROMPT}\n${content}`;

  const response = await chatWithMistral({ prompt, maxTokens: 2048 });

  const parsed = parseJson<{ chainOfThought?: string; is_relevant_content?: boolean }>(response);
  if (!parsed) return { isRelevant: false, reasoning: "Failed to parse LLM response" };

  return {
    isRelevant: parsed.is_relevant_content ?? false,
    reasoning: parsed.chainOfThought ?? "",
  };
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
