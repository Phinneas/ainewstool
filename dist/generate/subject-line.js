import { z } from "zod/v4";
import { chatWithKimi } from "../llm/kimi.js";
import { log } from "../logger.js";
const SUBJECT_LINE_EXAMPLES = `- AI finds cancers with 99% accuracy
- Claude (finally) searches the web
- OpenAI's regulatory power play
- Ilya's secret ASI roadmap
- Apple's AI emergency
- DeepMind's AI math genius
- Mistral's speedy new assistant
- OpenAI goes nuclear
- AI's tutoring breakthrough
- OpenAI's $500B Stargate Project
- Meta's Manhattan-sized AI play
- OpenAI's first AI agent arrives
- OpenAI's o3 and o4-mini arrive
- Chipmaking rivals join forces
- Amazon is joining the reasoning race
- Claude enters the reasoning era
- Figure's home robot breakthrough
- OpenAI's ex-CTO launches rival lab
- OpenAI's new GPT-5 roadmap
- AI workforce coming: Anthropic's one-year prediction
- The state of AI in 2025 (according to Stanford)
- OpenAI's dev-focused GPT-4.1
- Google's new AI video generator rivals Sora
- China declares AI independence`;
export async function generateSubjectLine(stories, contentItems, date) {
    const prompt = `**Role:** Expert Email Copywriter Specializing in AI Content Engagement

**Core Objective:** Optimize email engagement elements (Subject Line, Pre-header Text) for an AI newsletter to maximize open rates, based on provided story data.

Today's date for the newsletter is *${date}*.

## Top Newsletter Stories

${JSON.stringify(stories, null, 2)}

## Writing Guidelines

You Should Avoid:
- AVOID ALL CAPS or excessive punctuation!!!
- Avoid making the news sound more significant than it actually is
- Avoid over-exaggeration
- Avoid using cliché and over-the-top buzzwords like "revolution" and "game-changing"

Your pre-header text should be a straightforward teaser (15-20 words max) that teases and hints at what other stories will be included on this newsletter (outside of the main story). You should follow the "PLUS:" format for the pre-header text. DO NOT end this pre-header text with a period "." character.

You must prefer concrete specificity. It is better to reference a specific model instead of a generic term like "Google's AI" or "Meta's AI".

## Great Subject Line Examples

${SUBJECT_LINE_EXAMPLES}

## Output Format

Respond with valid JSON:
{
  "subject_line_reasoning": "your detailed reasoning...",
  "subject_line": "7-9 word compelling subject line about the lead story",
  "additional_subject_lines": ["alt1", "alt2", "alt3", "alt4", "alt5"],
  "pre_header_text_reasoning": "your reasoning...",
  "pre_header_text": "PLUS: teaser about other stories"
}

The subject line MUST be 7-9 words and focus exclusively on the lead story (first story).`;
    const response = await chatWithKimi({
        system: "You are an expert email copywriter. Always respond with valid JSON.",
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
        if (!jsonMatch)
            throw new Error("No JSON found");
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
    }
    catch (err) {
        if (err instanceof Error && err.message.includes("schema"))
            throw err;
        log.error("Failed to parse subject line", { error: err instanceof Error ? err.message : String(err) });
        log.error("Raw LLM response", { response: response.slice(0, 2000) });
        throw new Error("Failed to parse subject line from LLM");
    }
}
