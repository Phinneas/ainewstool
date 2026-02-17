import { chatWithMistral } from "../llm/mistral.js";

export interface EvaluationResult {
  isRelevant: boolean;
  reasoning: string;
}

export async function evaluateContentRelevance(
  content: string
): Promise<EvaluationResult> {
  const prompt = `Given content fetched from a web page, analyze this content to determine if it is a full piece of content that would be considered relevent to our AI Newsletter which features stories, advancements, and other interesting happenings in the tech and AI space.

- Job postings are not relevant content
- Content centered around unrelated industries is not relevant
- Only AI and AI Adjacent content should be considered relevant

You must respond with valid JSON in this exact format:
{
  "chainOfThought": "your reasoning here",
  "is_relevant_content": true/false
}

---
${content}`;

  const response = await chatWithMistral({ prompt, maxTokens: 2048 });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { isRelevant: false, reasoning: "Failed to parse" };

    const parsed = JSON.parse(jsonMatch[0]) as {
      chainOfThought?: string;
      is_relevant_content?: boolean;
    };
    return {
      isRelevant: parsed.is_relevant_content ?? false,
      reasoning: parsed.chainOfThought ?? "",
    };
  } catch {
    return { isRelevant: false, reasoning: "Failed to parse LLM response" };
  }
}
