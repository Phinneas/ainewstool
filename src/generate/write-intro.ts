import { z } from "zod/v4";
import { chatWithClaude } from "../llm/anthropic.js";
import { log } from "../logger.js";
import { WRITE_INTRO_SYSTEM, WRITE_INTRO_INSTRUCTIONS } from "../prompts/write-intro.js";

export async function writeIntro(params: {
  subjectLine: string;
  preHeaderText: string;
  storySections: string;
  date: string;
}): Promise<string> {
  const { subjectLine, preHeaderText, storySections, date } = params;

  const prompt = `${WRITE_INTRO_INSTRUCTIONS}

Today's date for the newsletter is *${date}*.

## Your Task:

Based on the inputs below, generate the intro section for the "BrainScriblr" newsletter.

### Subject Line
${subjectLine}

### Pre-header Text
${preHeaderText}

### Newsletter Content
${storySections}`;

  const response = await chatWithClaude({
    system: WRITE_INTRO_SYSTEM,
    prompt,
    maxTokens: 4096,
  });

  const IntroSchema = z.object({
    chainOfThought: z.string().optional(),
    newsletter_intro_section_content: z.string(),
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const result = IntroSchema.safeParse(JSON.parse(jsonMatch[0]));
    if (!result.success) {
      log.error("Intro validation failed", { issues: result.error.issues });
      log.error("Raw LLM response", { response: response.slice(0, 2000) });
      throw new Error("Intro response did not match expected schema");
    }
    return result.data.newsletter_intro_section_content;
  } catch (err) {
    if (err instanceof Error && err.message.includes("schema")) throw err;
    log.error("Failed to parse intro", { error: err instanceof Error ? err.message : String(err) });
    log.error("Raw LLM response", { response: response.slice(0, 2000) });
    throw new Error("Failed to parse intro from LLM");
  }
}
