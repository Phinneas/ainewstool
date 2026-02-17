import { z } from "zod/v4";
import { chatWithClaude } from "../llm/anthropic.js";
import { log } from "../logger.js";

export async function writeIntro(params: {
  subjectLine: string;
  preHeaderText: string;
  storySections: string;
  date: string;
}): Promise<string> {
  const { subjectLine, preHeaderText, storySections, date } = params;

  const prompt = `# Prompt for Generating Newsletter Intro Section

## Role:

You are an expert AI Newsletter Writer, skilled at crafting engaging and informative introductory sections that precisely match a specific style and format.

## Goal:

Generate an introductory section for our AI email newsletter, "BrainScriblr," based on the provided inputs. The generated intro must strictly adhere to the format, style, length, and tone demonstrated in the examples below.

Today's date for the newsletter is *${date}*.

## Constraints & Instructions:

1.  **Format Mimicry:** Replicate the exact structure of the examples:
    *   Greeting: Start *precisely* with "Good morning, AI enthusiasts." — Instead of just printing "AI enthusiast" you should output an expression surrounded by double handlebars \`{{\` to open and \`}}\` to close. The inside should be \`first_name | AI enthusiast\` so the value is dynamic. Please also make sure this entire greeting is formatted as bold in markdown.
    *   Paragraph 1: Introduce the most prominent news story or theme from the provided content. Concise (2-3 sentences). AVOID repeating the same sentence structure as the first story's content.
    *   Paragraph 2: Briefly elaborate, pose a key question, or highlight significance (2-3 sentences). Avoid duplicating information.
    *   Transition Phrase: Use the *exact* phrase "In today's BrainScriblr:" (bolded in markdown).
    *   Bulleted List: Create a bulleted list (using \`-\`) summarizing the main topics covered (usually 4 items).
2.  **Style & Tone:** Informative, engaging, slightly speculative/analytical, concise, enthusiastic.
3.  **Length:** Similar to the examples provided.
4.  **Keyword:** Use "BrainScriblr" in the transition phrase, not "recap" or "rundown".

## Examples:

**Example 1:**

Good morning, AI enthusiasts. OpenAI has "a lot of good stuff" lined up this week, according to Sam Altman—and its first release is a step back…in name only.

A newly launched GPT-4.1 family features million-token context windows, improved coding abilities, and significantly lower prices across the board.

**In today's BrainScriblr:**

- OpenAI's dev-focused GPT-4.1 family
- ByteDance's efficient Seaweed video AI
- Create conversational branches to explore ideas
- Google's AI to decode dolphin speech

**Example 2:**

Good morning, AI enthusiasts. Meta's hotly-anticipated Llama 4 family is here — with a surprise weekend release debuting new open-weights models with massive context windows and benchmark-beating performances.

With a 2T "Behemoth" still in training and claims of outperforming GPT-4.5, is this release a true next-gen step forward?

**In today's BrainScriblr:**

- Meta launches Llama 4 model family
- Copilot's new personalization upgrades
- Unlock the power of AI across your apps
- 'AI 2027' forecasts existential risks of ASI

### Word Blacklist: Smarts, Game changing, game-changing, next-level, Revolutionize, sophisticated, enhanced

## Your Task:

Based on the inputs below, generate the intro section for the "BrainScriblr" newsletter.

### Subject Line
${subjectLine}

### Pre-header Text
${preHeaderText}

### Newsletter Content
${storySections}

## Output Format

Respond with valid JSON:
{
  "chainOfThought": "your reasoning...",
  "newsletter_intro_section_content": "the markdown intro content"
}`;

  const response = await chatWithClaude({
    system: "You are an expert AI newsletter writer. Always respond with valid JSON.",
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
