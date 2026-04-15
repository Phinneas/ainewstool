/**
 * Prompt for evaluating whether a fetched web page is relevant to the AI newsletter.
 * Append the raw content after the trailing `---` separator before sending to the LLM.
 */
export const EVALUATE_NEWS_PROMPT = `Given content fetched from a web page, analyze this content to determine if it is a full piece of content that would be considered relevant to our AI Newsletter which features news stories, tutorials, research, and other interesting happenings in the tech and AI space.

## What IS relevant:
- AI/ML news, announcements, product launches, and industry developments
- Tutorials, guides, and how-to content about AI tools, frameworks, and techniques
- Research papers, paper summaries, and technical deep-dives on AI/ML topics
- AI policy, regulation, and societal impact analysis
- AI-adjacent technology (cloud infrastructure for AI, GPU/chip developments, developer tools)

## What is NOT relevant:
- Job postings or hiring announcements
- Content centered around industries unrelated to AI/tech
- Generic marketing content or product pages with no substantive information
- Content that is too short or thin to be useful (less than a few paragraphs)
- Listicles of AI tools with no analysis or insight

You must respond with valid JSON in this exact format:
{
  "chainOfThought": "your reasoning here",
  "is_relevant_content": true/false
}

---`;
