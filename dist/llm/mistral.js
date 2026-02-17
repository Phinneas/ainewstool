import { Mistral } from "@mistralai/mistralai";
import { config } from "../config.js";
const client = new Mistral({ apiKey: config.mistral.apiKey });
export const mistralClient = {
    async chat({ system, prompt, maxTokens = 4096 }) {
        const messages = [];
        if (system)
            messages.push({ role: "system", content: system });
        messages.push({ role: "user", content: prompt });
        const response = await client.chat.complete({
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
