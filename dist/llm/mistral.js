import { Mistral } from "@mistralai/mistralai";
import { config } from "../config.js";
import { apiKeys } from "./api-keys.js";
// Lazy client factory — reads the API key at call time, not at module load time.
// This is necessary in Cloudflare Workers where config.mistral.apiKey is '' at
// cold-start (isWorker=true), but apiKeys.mistral is set by the queue handler
// before any LLM calls are made.
function getClient() {
    const apiKey = config.mistral.apiKey || apiKeys.mistral || '';
    return new Mistral({ apiKey });
}
export const mistralClient = {
    async chat({ system, prompt, maxTokens = 4096 }) {
        const messages = [];
        if (system)
            messages.push({ role: "system", content: system });
        messages.push({ role: "user", content: prompt });
        const response = await getClient().chat.complete({
            model: "mistral-large-latest",
            messages,
            maxTokens,
        });
        return response.choices?.[0]?.message?.content ?? "";
    },
};
export async function chatWithMistral(params) {
    return mistralClient.chat(params);
}
