import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { apiKeys } from "./api-keys.js";
import type { ClaudeEffort, LLMClient } from "./types.js";

// Sonnet 5.5: $2/$10 per MTok, 1M context. Every Claude model ID is a pinned
// snapshot — including dateless ones from the 4.6 generation on — so this does
// not drift. Override with ANTHROPIC_MODEL (plain wrangler var) without a
// redeploy; `claude-sonnet-4-6` is the standing fallback if a 5.5 regression
// appears. Do NOT fall back to `claude-sonnet-4-5-20250929`: its retirement
// commitment expired 2026-09-29.
const DEFAULT_MODEL = "claude-sonnet-5-5";

// Lazy client factory — reads the API key at call time, not at module load time.
// This is necessary in Cloudflare Workers where config.anthropic.apiKey is '' at
// cold-start (isWorker=true), but apiKeys.anthropic is set by the queue handler
// before any LLM calls are made.
function getClient(): Anthropic {
  const apiKey = config.anthropic.apiKey || apiKeys.anthropic || '';
  return new Anthropic({ apiKey });
}

function getModel(): string {
  return config.anthropic.model || apiKeys.anthropicModel || DEFAULT_MODEL;
}

export const anthropicClient: LLMClient = {
  async chat({ system, prompt, maxTokens = 8192, model, effort }) {
    const response = await getClient().messages.create({
      model: model || getModel(),
      max_tokens: maxTokens,
      system: system ?? "",
      messages: [{ role: "user", content: prompt }],
      // Sonnet 5.5 has adaptive thinking ON by default at 'high' effort, and
      // thinking tokens count toward max_tokens. Callers that omit `effort`
      // get the most expensive setting, so it is set explicitly at every call
      // site rather than defaulted here. `thinking: {type:'disabled'}` is not
      // an escape hatch — Sonnet 5.5 rejects it with a 400.
      ...(effort ? { output_config: { effort } } : {}),
    });

    // Thinking overhead can consume the ceiling before the JSON is written.
    // Without this the failure surfaces two layers up as a zod schema error,
    // which sends you debugging the prompt instead of the budget.
    if (response.stop_reason === "max_tokens") {
      throw new Error(
        `Claude hit max_tokens (${maxTokens}) with effort=${effort ?? "unset"} — output truncated, likely thinking overhead`,
      );
    }

    // With adaptive thinking the content array can carry `thinking` blocks and
    // MORE THAN ONE text block — e.g. a short preamble followed by the JSON.
    // Taking only the first text block silently discards the payload, so join
    // them all.
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // Never return "" for a successful call. An empty string travels three
    // layers up and resurfaces as "Failed to parse story selection from LLM",
    // which points at the prompt instead of at this. Fail loudly with the
    // response shape so the next occurrence is self-diagnosing.
    if (!text.trim()) {
      throw new Error(
        `Claude returned no text content: stop_reason=${response.stop_reason}, ` +
          `blocks=[${response.content.map((b) => b.type).join(", ") || "none"}], ` +
          `effort=${effort ?? "unset"}, max_tokens=${maxTokens}`,
      );
    }

    return text;
  },
};

export async function chatWithClaude(params: {
  system?: string;
  prompt: string;
  maxTokens?: number;
  effort?: ClaudeEffort;
}): Promise<string> {
  return anthropicClient.chat(params);
}
