import { config } from "../config.js";
import type { LLMClient } from "./types.js";

const BASE_URL = "https://api.moonshot.cn/v1";

export const kimiClient: LLMClient = {
  async chat({ system, prompt, maxTokens = 8192 }) {
    const messages: Array<{ role: string; content: string }> = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.moonshot.apiKey}`,
      },
      body: JSON.stringify({
        model: "kimi-k2",
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Moonshot API error ${response.status}: ${errorBody}`
      );
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content ?? "";
  },
};

export async function chatWithKimi(params: {
  system?: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string> {
  return kimiClient.chat(params);
}
