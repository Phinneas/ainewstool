import { chatWithMistral } from "../llm/mistral.js";
import type { ScrapeResult } from "../storage/types.js";

export async function extractExternalSources(
  scrapeResult: ScrapeResult
): Promise<string> {
  const linksWithoutParams = scrapeResult.links.map((l) => l.split("?")[0]);

  const prompt = `You are given:

1. **Content Website**: The domain hosting the content (e.g., \`${scrapeResult.metadata.url}\`).
2. **Content Title and Body**: Text or markdown content extracted from a web page.
3. **Links Found on Content Page**: A list of hyperlinks that appear in or around the same article or page.

## Your Task

- Identify any **external source links** that are most relevant to the main topic of the content. It is possible there are NOT ANY good external source links.
- **External** means the link must be on a domain *different* from the Content Website's domain.
- **Relevance** means it must directly reference a primary source (e.g., a product announcement, study, press release, etc.) that underpins the main topic.
- **Exclude** links that are:
  - On the same domain as the Content Website
  - Generic homepages, profile pages, or unrelated side links
  - Not clearly connected to the main focus of the article
  - To storefront pages like eCommerce sites, to bookstore pages, to direct product listings, or other place to order a product directly.
  - To shopping websites like bookstores and other retail stores.
- If one or more valid external links exist, return them in a single comma-separated string as \`external_source_urls\`.
- If no external links meet these criteria, omit the \`external_source_urls\` field entirely.

## Output Format

Respond with valid JSON:
{
  "external_source_urls": "url1,url2"
}

Or if no valid external links:
{}

---
Content Website:
${scrapeResult.metadata.url}

Content Title:
${scrapeResult.metadata.title}

Content:
${scrapeResult.content}

Links Found on Content Page:
${linksWithoutParams.join("\n")}
`;

  const response = await chatWithMistral({ prompt, maxTokens: 2048 });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return "";
    const parsed = JSON.parse(jsonMatch[0]) as {
      external_source_urls?: string;
    };
    return parsed.external_source_urls ?? "";
  } catch {
    return "";
  }
}
