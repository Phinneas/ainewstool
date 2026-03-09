import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { apiKeys } from "./api-keys.js";
import type { LLMClient } from "./types.js";

// Lazy client factory — reads the API key at call time, not at module load time.
// This is necessary in Cloudflare Workers where config.anthropic.apiKey is '' at
// cold-start (isWorker=true), but apiKeys.anthropic is set by the queue handler
// before any LLM calls are made.
function getClient(): Anthropic {
  const apiKey = config.anthropic.apiKey || apiKeys.anthropic || '';
  return new Anthropic({ apiKey });
}

export const anthropicClient: LLMClient = {
  async chat({ system, prompt, maxTokens = 8192 }) {
    const response = await getClient().messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: maxTokens,
      system: system ?? "",
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.text ?? "";
  },
};

export async function chatWithClaude(params: {
  system?: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string> {
  return anthropicClient.chat(params);
}
