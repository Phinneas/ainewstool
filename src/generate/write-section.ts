import { z } from "zod/v4";
import { chatWithClaude } from "../llm/anthropic.js";
import { log } from "../logger.js";
import type { SelectedStory } from "./select-stories.js";
import { WRITE_SECTION_SYSTEM, WRITE_SECTION_INSTRUCTIONS } from "../prompts/write-section.js";

export interface SectionResult {
  content: string;
  reasoning: string;
}

export async function writeSection(params: {
  story: SelectedStory;
  storyContent: string;
  externalSourceContent: string;
  subjectLine: string;
  preHeaderText: string;
  date: string;
}): Promise<SectionResult> {
  const { story, storyContent, externalSourceContent, subjectLine, preHeaderText, date } = params;

  const prompt = `${WRITE_SECTION_INSTRUCTIONS}

Today's date for the newsletter is *${date}*.

## Newsletter Context

- Subject Line: ${subjectLine}
- Pre-Header Text: ${preHeaderText}

### Current Segment Story Context

Title: ${story.title}
Summary: ${story.summary}

${storyContent}

### Additional Current Segment Source Materials

${externalSourceContent || "N/A"}`;

  const response = await chatWithClaude({
    system: WRITE_SECTION_SYSTEM,
    prompt,
    maxTokens: 8192,
  });

  const SectionSchema = z.object({
    chainOfThought: z.string(),
    newsletter_section_content: z.string(),
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const result = SectionSchema.safeParse(JSON.parse(jsonMatch[0]));
    if (!result.success) {
      log.error("Section validation failed", { issues: result.error.issues });
      log.error("Raw LLM response", { response: response.slice(0, 2000) });
      throw new Error("Section response did not match expected schema");
    }
    return {
      content: result.data.newsletter_section_content,
      reasoning: result.data.chainOfThought,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("schema")) throw err;
    log.error("Failed to parse section content", { error: err instanceof Error ? err.message : String(err) });
    log.error("Raw LLM response", { response: response.slice(0, 2000) });
    throw new Error("Failed to parse section content from LLM");
  }
}
