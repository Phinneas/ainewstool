import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { LLMClient } from "./types.js";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

export const anthropicClient: LLMClient = {
  async chat({ system, prompt, maxTokens = 8192 }) {
    const response = await client.messages.create({
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
