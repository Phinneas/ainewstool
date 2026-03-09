import { config } from "../config.js";
import { apiKeys } from "./api-keys.js";
const BASE_URL = "https://api.moonshot.cn/v1";
// Lazy key reading — reads the API key at call time, not at module load time.
// This is necessary in Cloudflare Workers where config.moonshot.apiKey is '' at
// cold-start (isWorker=true), but apiKeys.moonshot is set by the queue handler
// before any LLM calls are made.
function getApiKey() {
    return config.moonshot.apiKey || apiKeys.moonshot || '';
}
export const kimiClient = {
    async chat({ system, prompt, maxTokens = 8192 }) {
        const messages = [];
        if (system)
            messages.push({ role: "system", content: system });
        messages.push({ role: "user", content: prompt });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);
        const response = await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${getApiKey()}`,
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
            throw new Error(`Moonshot API error ${response.status}: ${errorBody}`);
        }
        const data = (await response.json());
        return data.choices[0]?.message?.content ?? "";
    },
};
export async function chatWithKimi(params) {
    return kimiClient.chat(params);
}
