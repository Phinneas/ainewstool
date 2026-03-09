import { z } from "zod/v4";
import { chatWithClaude } from "../llm/anthropic.js";
import { log } from "../logger.js";
export async function writeShortlist(params) {
    const { subjectLine, storySections, date } = params;
    // Count story sections by looking for ## headers (story titles)
    const storyCount = (storySections.match(/^## /gm) || []).length;
    const prompt = `## Role:

You are an expert AI Newsletter Writer creating a TL;DR summary section for "BrainScriblr" newsletter.

## Context:

Create a "Quick Scribbles" section that summarizes ALL the main stories in this newsletter. This appears at the TOP of the newsletter to give readers a fast overview. Each item should be one concise sentence.

Today's date: *${date}*.

## CRITICAL REQUIREMENTS:

1. You MUST summarize ALL ${storyCount} main stories found in the content below
2. Use EXACTLY this bullet format for each story:
   - **Company/Topic** — One sentence summary.

## Subject Line
${subjectLine}

## Main Stories to Summarize (there are ${storyCount} stories)
${storySections}

## Output Format

Respond with valid JSON:
{
  "chainOfThought": "I found X stories and will summarize each one...",
  "quick_scribbles": "the markdown content with ALL ${storyCount} summaries as bullet points"
}

Example quick_scribbles format:
- **Microsoft** — Launched new document AI achieving 95%+ accuracy on complex layouts.
- **OpenAI** — Released updated model with improved reasoning capabilities.
- **Google** — Announced enterprise features for their AI assistant platform.
- **Meta** — Published research on multimodal understanding breakthroughs.`;
    const response = await chatWithClaude({
        system: "You are an expert AI newsletter writer. Always respond with valid JSON. You must include ALL stories in the summary.",
        prompt,
        maxTokens: 2048,
    });
    const ShortlistSchema = z.object({
        chainOfThought: z.string().optional(),
        quick_scribbles: z.string(),
    });
    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch)
            throw new Error("No JSON found");
        const result = ShortlistSchema.safeParse(JSON.parse(jsonMatch[0]));
        if (!result.success) {
            log.error("Shortlist validation failed", { issues: result.error.issues });
            log.error("Raw LLM response", { response: response.slice(0, 2000) });
            throw new Error("Shortlist response did not match expected schema");
        }
        // Validate that we have the expected number of bullet points
        const bulletCount = (result.data.quick_scribbles.match(/^- \*\*/gm) || []).length;
        if (bulletCount < storyCount) {
            log.warn(`Shortlist has ${bulletCount} bullets but expected ${storyCount} stories`);
        }
        return result.data.quick_scribbles;
    }
    catch (err) {
        if (err instanceof Error && err.message.includes("schema"))
            throw err;
        log.error("Failed to parse shortlist", { error: err instanceof Error ? err.message : String(err) });
        log.error("Raw LLM response", { response: response.slice(0, 2000) });
        throw new Error("Failed to parse shortlist from LLM");
    }
}
