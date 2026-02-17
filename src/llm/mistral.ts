import { Mistral } from "@mistralai/mistralai";
import { config } from "../config.js";
import type { LLMClient } from "./types.js";

const client = new Mistral({ apiKey: config.mistral.apiKey });

export const mistralClient: LLMClient = {
  async chat({ system, prompt, maxTokens = 4096 }) {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });

    const response = await client.chat.complete({
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
