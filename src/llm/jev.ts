/**
 * Jev (TypeSafe System One) client — OpenRouter Decisions API.
 *
 * Jev is NOT a chat model. It takes application state plus typed questions and
 * returns typed answers with calibrated probabilities in a single forward pass.
 * There is no generated text, so nothing to parse and no output tokens billed.
 *
 * Deliberately does not implement `LLMClient` — that interface returns
 * Promise<string>, and serialising probabilities to a string just to re-parse
 * them would reintroduce the fragility this replaces.
 *
 * Model: typesafe/jev-1.13 — $0.042/1M input, $0 output, 32K context.
 */
import { z } from "zod";
import { config } from "../config.js";
import { apiKeys } from "./api-keys.js";

// Pinned, not ~typesafe/jev-latest: thresholds tuned against one version must
// not shift under a silent model bump.
export const JEV_MODEL = "typesafe/jev-1.13";

// The Decisions API is plain HTTP and is the documented route. The
// /api/v1/systemone surface exists only for TypeSafe SDK compatibility.
const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export interface JevNoulQuestion {
  type: "noul";
  /** Yes/no question, or a statement for the model to judge. */
  instructions: string;
  /** Optional, but recommended — this is the decision boundary. */
  criteria?: { true: string; false: string };
}

export interface JevChoiceQuestion {
  type: "choice";
  instructions: string;
  /** Option key -> description. Always include an escape option ("belongs",
   *  "none", ...) or a forced pick assigns a bogus answer to every input. */
  criteria: Record<string, string>;
}

export interface JevScoreQuestion {
  type: "score";
  instructions: string;
  /** Ordered scale, index 0 = LOWEST. Returned `score` is a probability-weighted
   *  position on this array, so it is 0-based — offset when mapping to 1-based. */
  criteria: string[];
}

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

const NoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number(),
});

const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

const ScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  legend: z.record(z.string(), z.string()).optional(),
});

export const JevAnswerSchema = z.union([NoulAnswerSchema, ChoiceAnswerSchema, ScoreAnswerSchema]);
export type JevAnswer = z.infer<typeof JevAnswerSchema>;
export type JevNoulAnswer = z.infer<typeof NoulAnswerSchema>;
export type JevChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;
export type JevScoreAnswer = z.infer<typeof ScoreAnswerSchema>;

const JevResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  answers: z.record(z.string(), JevAnswerSchema),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      // USD for this call. Present on OpenRouter responses — record it rather
      // than estimating cost from token counts.
      cost: z.number().optional(),
    })
    .optional(),
});

export interface JevUsage {
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
}

export interface JevResult {
  answers: Record<string, JevAnswer>;
  usage: JevUsage;
  /** Dated snapshot that actually served the request, e.g. typesafe/jev-1.13-20260917. */
  model?: string;
  id?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** 413 — the payload exceeded Jev's 32K context. Caller should shrink state and retry. */
export class JevPayloadTooLargeError extends Error {
  constructor(public readonly detail: string) {
    super(`Jev payload too large (32K context): ${detail}`);
    this.name = "JevPayloadTooLargeError";
  }
}

/** Non-retryable failure: bad request, auth, or an unparseable response. */
export class JevError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "JevError";
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function getApiKey(): string {
  return config.openrouter.apiKey || apiKeys.openrouter || "";
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface DecideParams {
  state: string | Record<string, unknown> | unknown[];
  questions: Record<string, JevQuestion>;
  model?: string;
  /** Group related requests in OpenRouter observability — pass the batch id. */
  sessionId?: string;
  maxAttempts?: number;
}

export async function decide(params: DecideParams): Promise<JevResult> {
  const { state, questions, model = JEV_MODEL, sessionId, maxAttempts = 3 } = params;

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new JevError(
      "No OpenRouter API key. Set OPENROUTER_API_KEY (Node) or the OPENROUTER_API_KEY secret (Worker).",
      401,
    );
  }

  const body = JSON.stringify({
    model,
    state,
    questions,
    ...(sessionId ? { session_id: sessionId } : {}),
  });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(DECISIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch (err) {
      // Network failure — retryable.
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        await backoff(attempt);
        continue;
      }
      throw new JevError(`Jev request failed after ${maxAttempts} attempts: ${lastError.message}`);
    }

    if (response.status === 413) {
      // Distinct and non-retryable at this layer: only the caller knows how to
      // shrink `state`. Retrying the same payload would 413 identically.
      const detail = await safeText(response);
      throw new JevPayloadTooLargeError(detail);
    }

    if (RETRYABLE_STATUS.has(response.status)) {
      lastError = new JevError(
        `Jev returned ${response.status}: ${await safeText(response)}`,
        response.status,
      );
      if (attempt < maxAttempts) {
        await backoff(attempt, response.headers.get("retry-after"));
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      // 400 / 401 / 404 — retrying will not help.
      throw new JevError(
        `Jev returned ${response.status}: ${await safeText(response)}`,
        response.status,
      );
    }

    const raw: unknown = await response.json();
    const parsed = JevResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new JevError(
        `Jev response did not match expected schema: ${parsed.error.message}`,
      );
    }

    return {
      answers: parsed.data.answers,
      usage: parsed.data.usage ?? {},
      model: parsed.data.model,
      id: parsed.data.id,
    };
  }

  // Unreachable — every path above returns or throws.
  throw new JevError(`Jev request failed: ${lastError?.message ?? "unknown error"}`);
}

function backoff(attempt: number, retryAfter?: string | null): Promise<void> {
  const fromHeader = Number(retryAfter);
  const ms =
    retryAfter && Number.isFinite(fromHeader) && fromHeader > 0
      ? fromHeader * 1000
      : Math.min(1000 * 2 ** (attempt - 1), 8000);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Answer helpers
// ---------------------------------------------------------------------------

/** Read a noul answer. Returns undefined when absent rather than throwing, so
 *  callers can decide whether a missing answer is fatal. */
export function readNoul(answers: Record<string, JevAnswer>, key: string): number | undefined {
  const a = answers[key];
  return a && a.type === "noul" ? a.noul : undefined;
}

export function readChoice(
  answers: Record<string, JevAnswer>,
  key: string,
): JevChoiceAnswer | undefined {
  const a = answers[key];
  return a && a.type === "choice" ? a : undefined;
}

export function readScore(
  answers: Record<string, JevAnswer>,
  key: string,
): JevScoreAnswer | undefined {
  const a = answers[key];
  return a && a.type === "score" ? a : undefined;
}
