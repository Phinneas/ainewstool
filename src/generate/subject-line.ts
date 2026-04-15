import { z } from "zod/v4";
import { chatWithClaude } from "../llm/anthropic.js";
import { log } from "../logger.js";
import type { SelectedStory } from "./select-stories.js";
import { SUBJECT_LINE_SYSTEM, SUBJECT_LINE_INSTRUCTIONS, SUBJECT_LINE_EXAMPLES } from "../prompts/subject-line.js";

export interface SubjectLineResult {
  subjectLine: string;
  preHeaderText: string;
  alternativeSubjectLines: string[];
}

export async function generateSubjectLine(
  stories: SelectedStory[],
  contentItems: Array<{ identifier: string; content: string }>,
  date: string
): Promise<SubjectLineResult> {
  const prompt = `${SUBJECT_LINE_INSTRUCTIONS}

Today's date for the newsletter is *${date}*.

## Top Newsletter Stories

${JSON.stringify(stories, null, 2)}

## Great Subject Line Examples

${SUBJECT_LINE_EXAMPLES}`;

  const response = await chatWithClaude({
    system: SUBJECT_LINE_SYSTEM,
    prompt,
    maxTokens: 4096,
  });

  const SubjectLineSchema = z.object({
    subject_line_reasoning: z.string().optional(),
    subject_line: z.string(),
    additional_subject_lines: z.array(z.string()),
    pre_header_text_reasoning: z.string().optional(),
    pre_header_text: z.string(),
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const result = SubjectLineSchema.safeParse(JSON.parse(jsonMatch[0]));
    if (!result.success) {
      log.error("Subject line validation failed", { issues: result.error.issues });
      log.error("Raw LLM response", { response: response.slice(0, 2000) });
      throw new Error("Subject line response did not match expected schema");
    }
    return {
      subjectLine: result.data.subject_line,
      preHeaderText: result.data.pre_header_text,
      alternativeSubjectLines: result.data.additional_subject_lines,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("schema")) throw err;
    log.error("Failed to parse subject line", { error: err instanceof Error ? err.message : String(err) });
    log.error("Raw LLM response", { response: response.slice(0, 2000) });
    throw new Error("Failed to parse subject line from LLM");
  }
}
