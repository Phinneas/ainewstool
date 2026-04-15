/**
 * Prompt for scoring an AI research paper for newsletter inclusion.
 * Append the paper content after a `---` separator before sending to the LLM.
 *
 * Acceptance threshold: score >= 6
 */
export const EVALUATE_RESEARCH_PROMPT = `You are evaluating an AI research paper for a technically curious but non-academic newsletter audience.

Score this paper from 1-10 on:
- Accessibility: Can the key insight be explained in 2 sentences to a developer? (40%)
- Novelty: Does it represent a genuinely new approach or result? (35%)
- Relevance: Does it have practical implications for AI practitioners? (25%)

Return JSON: { "score": number, "headline": string, "tldr": string }
The headline should read like a newsletter headline, not an academic title.
The tldr should be 1-2 sentences a developer would find interesting.`;
