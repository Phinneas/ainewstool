import { z } from "zod/v4";
import { chatWithClaude } from "../llm/anthropic.js";
import { log } from "../logger.js";
import type { SelectedStory } from "./select-stories.js";

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

  const prompt = `## Task and Purpose

Create a single newsletter section focused on **AI developments, tools, and applications** that help professionals automate tasks, boost productivity, and stay on the cutting edge. You will be given details of a single section to write about and supporting source material. Use this to write this newsletter section.

Today's date for the newsletter is *${date}*.

### Audience

- **Tech-forward readers**—developers, entrepreneurs, AI enthusiasts, and early adopters.
- Those looking for **new AI trends**, developments, and **real-world use cases** that can make their work more efficient.

### Style Inspiration

- **Axios-like** and **Rundown** approach with **short, punchy paragraphs**, clear headers, bullet points, and a **"Why it matters"** or **"Bottom line"** section.
- **Enthusiastic, optimistic, forward-looking** voice that highlights AI's future-shaping potential.

### Additional Writing Guidelines

- Place verbs directly after helping verbs like "makes," "allows," "enables"
- Emphasize user actions rather than abstract processes
- Use clear subject-verb-object structure whenever possible
- Keep sentences concise and purposeful
- Avoid unnecessary nominalization and keep the language direct and dynamic.
- Avoid technical jargon. Your writing should be easy to understand for non-technical readers.

### Section Structure

Follow this structure when writing your newsletter segment:

1. **The Scoop:** (should be bolded)
  - Provide a **quick summary and overview** of the topic.
  - This should be a brief 1-2 sentences.
  - Start this section with **The Scoop:** followed by your 1-2 sentences.

2. **Unpacked:** (should be bolded)
  - Expand on **additional details** and context around the story.
  - Formatted as a bulleted list where each bullet item is a single sentence.
  - Use the \`-\` character for each bullet in this section.
  - Provide 3 bullets. Each must be relevant and provide necessary context.
  - Maximum of 1 link per bullet. Links must NOT be bold.
  - Maximum of 1 bold phrase per bullet.

3. **Bottom line:** (should be bolded)
  - A **short, final insight** into why this story matters. Must be 2 sentences.
  - AVOID "We're" or "We are" in this section.
  - Avoid overly-flowery language.

### Tone and Voice

1. **Optimistic and Enthusiastic** — balanced, non-overbearing
2. **Clear, Direct, and Data-Driven** — bullet points, bolded keywords
3. **Conversational and Personable** — "we," "you"
4. **Authoritative Without Being Overly Formal** — cite sources, link to relevant external sources

### Word Blacklist: Smarts, Game changing, Revolutionize, sophisticated

### Formatting

- Short paragraphs (1-2 sentences). Bullet points for features/stats.
- **Bold** key data points. Use *italics* sparingly.
- Format in markdown. Section heading should use \`#\` heading level.

### Link Requirements

- Link specific entities to their official source on first mention.
- All links MUST point to exact, specific pages (NOT generic homepages).
- Maximum 1 link per paragraph or bullet point.
- Links must be copied verbatim from source materials. Do NOT modify URLs.
- If no valid URL exists, omit the link entirely.

## Newsletter Context

- Subject Line: ${subjectLine}
- Pre-Header Text: ${preHeaderText}

### Current Segment Story Context

Title: ${story.title}
Summary: ${story.summary}

${storyContent}

### Additional Current Segment Source Materials

${externalSourceContent || "N/A"}

## Output Format

Respond with valid JSON:
{
  "chainOfThought": "your reasoning...",
  "newsletter_section_content": "the markdown content of this section"
}`;

  const response = await chatWithClaude({
    system:
      "You are an expert AI copywriter tasked with creating engaging newsletter segments that resonate with a tech-savvy audience. Always respond with valid JSON.",
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
