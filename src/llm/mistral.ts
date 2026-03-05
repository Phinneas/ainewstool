import { Mistral } from "@mistralai/mistralai";
import { config } from "../config.js";
import type { LLMClient } from "./types.js";

// Lazy client factory — reads the API key at call time, not at module load time.
// This is necessary in Cloudflare Workers where config.mistral.apiKey is '' at
// cold-start (isWorker=true), but process.env.MISTRAL_API_KEY is injected by the
// queue handler before any LLM calls are made.
function getClient(): Mistral {
  const apiKey = config.mistral.apiKey || process.env?.MISTRAL_API_KEY || '';
  return new Mistral({ apiKey });
}

export const mistralClient: LLMClient = {
  async chat({ system, prompt, maxTokens = 4096 }) {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });

    const response = await getClient().chat.complete({
      model: "mistral-large-latest",
      messages,
      maxTokens,
    });

    return response.choices?.[0]?.message?.content as string ?? "";
  },
};

export async function chatWithMistral(params: {
  system?: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string> {
  return mistralClient.chat(params);
}
