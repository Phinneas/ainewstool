import { z } from "zod/v4";
import { chatWithClaude } from "../llm/anthropic.js";
import { log } from "../logger.js";

export async function writeShortlist(params: {
  subjectLine: string;
  storySections: string;
  allContent: string;
  previousNewsletter?: string;
  date: string;
}): Promise<string> {
  const { subjectLine, storySections, allContent, previousNewsletter, date } = params;

  const prompt = `## Role:

You are an expert AI Newsletter Writer, specializing in crafting concise, engaging, and informative summaries of the latest AI news for a tech-savvy audience. You are writing a specific section for the newsletter "BrainScriblr".

## Context:

We are creating the "Other Top AI Stories" section for our email newsletter, "BrainScriblr". This section should highlight interesting and relevant AI news items that were *not* covered in the main segments of the newsletter. The goal is to provide readers with a quick overview of other significant developments in the AI space. The stories you pick MUST be related to AI.

Today's date for the newsletter is *${date}*.

## Task:

Analyze the provided list of AI news stories, select the most relevant and interesting stories for a tech and AI enthusiast audience (typically 3-5 stories), ensuring they do *not* overlap with the stories already in the newsletter, and write a short summary for each selected story in the specified format.

You must include a minimum of at least 3 stories. If there is not a valid link to include, omit that story.

## Formatting and Style Requirements:
*   **Output Format:** Markdown.
*   **Story Structure:**
    *   The **first word** of each story summary *must* be **bolded**.
    *   The **second word** *must* be a **verb** and formatted as a Markdown **link** (\`[verb](URL)\`).
    *   The rest should be a concise summary of the story's key takeaway.
*   **Style:** Mimic "The Rundown" style. Concise, informative, slightly informal, engaging.
*   Each story must be its own paragraph. **Do NOT use bullet points or numbered lists.**

## Examples:

**NVIDIA** [released](URL) Nemotron-Ultra, a 253B parameter open-source reasoning model that surpasses DeepSeek R1 and Llama 4 Behemoth across key benchmarks.

**OpenAI** [published](URL) its EU Economic Blueprint, proposing a €1B AI accelerator fund and aiming to train 100M Europeans in AI skills by 2030.

**Deep Cogito** [emerged](URL) from stealth with Cogito v1 Preview, a family of open-source models that it claims beats the best available open models of the same size.

## Link Requirements:

- All links MUST be copied verbatim from the source material. Do NOT modify URLs.
- NO generic homepages. Links must point to specific pages.
- If no valid URL exists for a story, omit that story entirely.

## Subject Line
${subjectLine}

## Main Stories Already Covered (Do NOT repeat these)
${storySections}

${previousNewsletter ? `## Previous Newsletter (avoid duplicates)\n\n${previousNewsletter}` : ""}

## List of Potential Other AI Stories
${allContent}

## Output Format

Respond with valid JSON:
{
  "chainOfThought": "your reasoning for each story selection and link verification...",
  "newsletter_other_top_stories_section_content": "the markdown content"
}`;

  const response = await chatWithClaude({
    system: "You are an expert AI newsletter writer. Always respond with valid JSON.",
    prompt,
    maxTokens: 4096,
  });

  const ShortlistSchema = z.object({
    chainOfThought: z.string().optional(),
    newsletter_other_top_stories_section_content: z.string(),
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const result = ShortlistSchema.safeParse(JSON.parse(jsonMatch[0]));
    if (!result.success) {
      log.error("Shortlist validation failed", { issues: result.error.issues });
      log.error("Raw LLM response", { response: response.slice(0, 2000) });
      throw new Error("Shortlist response did not match expected schema");
    }
    return result.data.newsletter_other_top_stories_section_content;
  } catch (err) {
    if (err instanceof Error && err.message.includes("schema")) throw err;
    log.error("Failed to parse shortlist", { error: err instanceof Error ? err.message : String(err) });
    log.error("Raw LLM response", { response: response.slice(0, 2000) });
    throw new Error("Failed to parse shortlist from LLM");
  }
}
