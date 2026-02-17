import { z } from "zod/v4";
import { chatWithKimi } from "../llm/kimi.js";
import { log } from "../logger.js";
export async function selectTopStories(contentItems, previousNewsletter) {
    const contentText = contentItems
        .map((item) => `<${item.identifier}>\n---\nidentifier: ${item.identifier}\nfriendlyType: ${item.type}\nsourceName: ${item.sourceName}\nexternalSourceUrls: ${item.externalSourceUrls}\n---\n\n${item.content}\n</${item.identifier}>`)
        .join("\n\n");
    const prompt = `You are an AI assistant specialized in reading raw text about AI-related news, trends, and breakthroughs. Your objective is to determine which stories should be included in our AI Tools newsletter, based on their relevance, impact, and interest to a tech-savvy audience. You are also an expert at crafting subject lines for newsletter emails that leads to great open rates and keeps our readers interested.

## Task

Select the top 4 stories from the provided content to feature in our AI newsletter. These should be the most impactful, interesting, and relevant stories for our audience of AI enthusiasts, developers, entrepreneurs, and early adopters.

## Selection Criteria

1. **Impact**: Stories about major announcements, breakthroughs, or significant developments in AI
2. **Relevance**: Stories directly related to AI, machine learning, or AI-adjacent technology
3. **Interest**: Stories that would genuinely interest and excite our tech-savvy audience
4. **Diversity**: Try to cover different aspects of AI (products, research, business, policy)
5. **Recency**: Prefer newer developments over older news

## Content to Evaluate

${contentText}

${previousNewsletter ? `## Previous Newsletter (avoid duplicating these stories)\n\n${previousNewsletter}` : ""}

## Output Format

You MUST respond with valid JSON in this exact format:
{
  "top_selected_stories_chain_of_thought": "Your detailed reasoning for each story selection and rejection...",
  "top_selected_stories": [
    {
      "title": "A concise, catchy headline for this story section",
      "summary": "A brief summary of this story with notes on what to expand on",
      "identifiers": ["identifier1", "identifier2"],
      "external_source_links": ["url1", "url2"]
    }
  ]
}

Select exactly 4 stories. The first story should be the most impactful/important one (the lead story).`;
    const response = await chatWithKimi({
        system: "You are an AI assistant specialized in analyzing AI news and selecting the most impactful stories for a newsletter. Always respond with valid JSON.",
        prompt,
        maxTokens: 8192,
    });
    const StorySelectionSchema = z.object({
        top_selected_stories_chain_of_thought: z.string(),
        top_selected_stories: z.array(z.object({
            title: z.string(),
            summary: z.string(),
            identifiers: z.array(z.string()),
            external_source_links: z.array(z.string()),
        })),
    });
    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch)
            throw new Error("No JSON found in response");
        const result = StorySelectionSchema.safeParse(JSON.parse(jsonMatch[0]));
        if (!result.success) {
            log.error("Story selection validation failed", { issues: result.error.issues });
            log.error("Raw LLM response", { response: response.slice(0, 2000) });
            throw new Error("Story selection response did not match expected schema");
        }
        return {
            reasoning: result.data.top_selected_stories_chain_of_thought,
            stories: result.data.top_selected_stories,
        };
    }
    catch (err) {
        if (err instanceof Error && err.message.includes("schema"))
            throw err;
        log.error("Failed to parse story selection", { error: err instanceof Error ? err.message : String(err) });
        log.error("Raw LLM response", { response: response.slice(0, 2000) });
        throw new Error("Failed to parse story selection from LLM");
    }
}
