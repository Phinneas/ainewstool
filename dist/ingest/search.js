import { config } from "../config.js";
import { log } from "../logger.js";
const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v1/search";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function firecrawlSearch(query, limit = 5) {
    const body = {
        query,
        limit,
        scrapeOptions: {
            formats: ["markdown"],
            onlyMainContent: true,
        },
    };
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 120_000);
            const response = await fetch(FIRECRAWL_SEARCH_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${config.firecrawl.apiKey}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) {
                const errorText = await response.text();
                log.warn(`Firecrawl search error`, {
                    attempt,
                    maxRetries: MAX_RETRIES,
                    status: response.status,
                    error: errorText,
                    query,
                });
                if (attempt < MAX_RETRIES) {
                    await sleep(RETRY_DELAY_MS);
                    continue;
                }
                return [];
            }
            const data = (await response.json());
            if (!data.success || !data.data) {
                log.warn(`Firecrawl search unsuccessful`, { attempt, query });
                if (attempt < MAX_RETRIES) {
                    await sleep(RETRY_DELAY_MS);
                    continue;
                }
                return [];
            }
            log.info(`Firecrawl search returned ${data.data.length} results`, { query });
            return data.data;
        }
        catch (err) {
            log.warn(`Firecrawl search fetch error`, {
                attempt,
                maxRetries: MAX_RETRIES,
                error: err instanceof Error ? err.message : String(err),
                query,
            });
            if (attempt < MAX_RETRIES)
                await sleep(RETRY_DELAY_MS);
        }
    }
    return [];
}
