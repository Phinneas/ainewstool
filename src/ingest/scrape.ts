// Use env var directly to avoid pulling in S3 config
// In Workers, API key is passed via env parameter, not process.env

import { log } from "../logger.js";
import type { ScrapeResult } from "../storage/types.js";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v1/scrape";
const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 2000;
const MAX_TIMEOUT_MS = 45000; // 45 seconds max per scrape

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scrapeUrl(url: string, apiKey?: string): Promise<ScrapeResult | null> {
  // Try passed apiKey first, then process.env (Node.js), then global ( Workers)
  const effectiveApiKey = apiKey || process.env?.FIRECRAWL_API_KEY || (globalThis as any).FIRECRAWL_API_KEY;
  
  if (!effectiveApiKey) {
    log.warn(`Firecrawl API key not available`);
    return null;
  }
  const body = {
    url,
    formats: ["json", "markdown", "rawHtml", "links"],
    excludeTags: ["iframe", "nav", "header", "footer"],
    onlyMainContent: true,
    timeout: 30000, // 30 second timeout per scrape
    jsonOptions: {
      prompt:
        "Identify the main content of the text (i.e., the article or newsletter body). Provide the exact text for that main content verbatim, without summarizing or rewriting any part of it. Exclude all non-essential elements such as banners, headers, footers, calls to action, ads, or purely navigational text. Format this output as markdown using appropriate '#' characters as heading levels. Exclude any promotional or sponsored content on your output. Additionally, you must identify and extract the image urls within this main content. These images must be inside the main content of the page so you must exclude small logo images, icons, avatars and other images which aren't a core part of the main content. The images you extract should at least have a width of 600 pixels (px) so it can be included on our content.",
      schema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "The exact verbatim main text content of the web page in markdown format.",
          },
          main_content_image_urls: {
            type: "array",
            items: {
              type: "string",
              description:
                "An image url that appears within the main content of the web page. This image must be inside the main content of the page so you must exclude small logo images, icons, avatars and other images which aren't a core part of the main content. The image should be at least 600px in width.",
            },
            description:
              "An array of the exact image urls that appear within the main content of the web page. Extra images such as icons and images not relevant to the main content MUST be excluded.",
          },
        },
        required: ["content", "main_content_image_urls"],
      },
    },
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), MAX_TIMEOUT_MS);

      const response = await fetch(FIRECRAWL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${effectiveApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        log.warn(`Firecrawl error`, { attempt, maxRetries: MAX_RETRIES, status: response.status, error: errorText });
        if (attempt < MAX_RETRIES) {
          // Exponential backoff: 2s, 4s
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          log.info(`Retrying in ${delay}ms...`);
          await sleep(delay);
          continue;
        }
        return null;
      }

      const data = (await response.json()) as {
        success: boolean;
        data: {
          json?: {
            content?: string;
            main_content_image_urls?: string[];
          };
          markdown?: string;
          rawHtml?: string;
          links?: string[];
          metadata?: { url?: string; title?: string };
        };
      };

      if (!data.success || !data.data) {
        if (attempt < MAX_RETRIES) {
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          log.info(`Retrying in ${delay}ms...`);
          await sleep(delay);
          continue;
        }
        return null;
      }

      return {
        content: data.data.json?.content ?? data.data.markdown ?? "",
        mainContentImageUrls:
          data.data.json?.main_content_image_urls ?? [],
        rawHtml: data.data.rawHtml ?? "",
        links: data.data.links ?? [],
        metadata: {
          url: data.data.metadata?.url ?? url,
          title: data.data.metadata?.title ?? "",
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.warn(`Firecrawl fetch error`, { attempt, maxRetries: MAX_RETRIES, error: errorMsg });
      
      // Don't retry on abort/timeout errors after max retries
      if (errorMsg.includes('abort') || errorMsg.includes('timeout')) {
        log.warn(`Timeout/abort error, skipping retries for ${url}`);
        return null;
      }
      
      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        log.info(`Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  return null;
}
