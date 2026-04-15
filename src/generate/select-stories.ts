import { z } from "zod/v4";
import { chatWithClaude } from "../llm/anthropic.js";
import { log } from "../logger.js";
import { SELECT_STORIES_SYSTEM, SELECT_STORIES_INSTRUCTIONS } from "../prompts/select-stories.js";

export interface SelectedStory {
  title: string;
  summary: string;
  identifiers: string[];
  external_source_links: string[];
}

export interface StorySelectionResult {
  reasoning: string;
  stories: SelectedStory[];
}

export async function selectTopStories(
  contentItems: Array<{ identifier: string; title: string; sourceName: string; type: string; content: string; externalSourceUrls: string }>,
  previousNewsletter?: string
): Promise<StorySelectionResult> {
  const contentText = contentItems
    .map(
      (item) =>
        `<${item.identifier}>\n---\nidentifier: ${item.identifier}\nfriendlyType: ${item.type}\nsourceName: ${item.sourceName}\nexternalSourceUrls: ${item.externalSourceUrls}\n---\n\n${item.content}\n</${item.identifier}>`
    )
    .join("\n\n");

  const previousSection = previousNewsletter
    ? `## Previous Newsletter (avoid duplicating these stories)\n\n${previousNewsletter}\n\n`
    : "";

  const prompt = `${SELECT_STORIES_INSTRUCTIONS}

## Content to Evaluate

${contentText}

${previousSection}`;

  const response = await chatWithClaude({
    system: SELECT_STORIES_SYSTEM,
    prompt,
    maxTokens: 8192,
  });

  const StorySelectionSchema = z.object({
    top_selected_stories_chain_of_thought: z.string(),
    top_selected_stories: z.array(
      z.object({
        title: z.string(),
        summary: z.string(),
        identifiers: z.array(z.string()),
        external_source_links: z.array(z.string()),
      })
    ),
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
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
  } catch (err) {
    if (err instanceof Error && err.message.includes("schema")) throw err;
    log.error("Failed to parse story selection", { error: err instanceof Error ? err.message : String(err) });
    log.error("Raw LLM response", { response: response.slice(0, 2000) });
    throw new Error("Failed to parse story selection from LLM");
  }
}
