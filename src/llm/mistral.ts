import { Mistral } from "@mistralai/mistralai";
import { config } from "../config.js";
import { apiKeys } from "./api-keys.js";
import type { LLMClient } from "./types.js";

// Lazy client factory — reads the API key at call time, not at module load time.
// This is necessary in Cloudflare Workers where config.mistral.apiKey is '' at
// cold-start (isWorker=true), but apiKeys.mistral is set by the queue handler
// before any LLM calls are made.
function getClient(): Mistral {
  const apiKey = config.mistral.apiKey || apiKeys.mistral || '';
  return new Mistral({ apiKey });
}

export const mistralClient: LLMClient = {
  async chat({ system, prompt, maxTokens = 4096, model = "mistral-medium" }) {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });

    const response = await getClient().chat.complete({
      model: model,
      messages,
      maxTokens,
      temperature: 0.0,
    });

    return response.choices?.[0]?.message?.content as string ?? "";
  },
};

export async function chatWithMistral(params: {
  system?: string;
  prompt: string;
  maxTokens?: number;
  model?: string;
}): Promise<string> {
  return mistralClient.chat(params);
}
