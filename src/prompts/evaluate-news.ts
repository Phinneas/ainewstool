/**
 * Prompt for evaluating whether a fetched web page is relevant to the AI newsletter.
 * Append the raw content after the trailing `---` separator before sending to the LLM.
 */
export const EVALUATE_NEWS_PROMPT = `Given content fetched from a web page, analyze this content to determine if it is relevant to our AI Newsletter which features news stories, tutorials, research, and other interesting happenings in the tech and AI space.

Be reasonably inclusive - if the content has some value for AI/tech practitioners or enthusiasts, lean toward accepting it.

## What IS relevant:
- AI/ML news, announcements, product launches, and industry developments
- Tutorials, guides, and how-to content about AI tools, frameworks, and techniques
- Research papers, paper summaries, and technical deep-dives on AI/ML topics
- AI policy, regulation, and societal impact analysis
- AI-adjacent technology (cloud infrastructure for AI, GPU/chip developments, developer tools)

## What is NOT relevant:
- Pure job postings or hiring announcements (tutorials about AI careers are OK)
- Content completely unrelated to AI/tech/software
- Marketing pages with zero technical content or insights
- Content that is extremely short (less than a paragraph)
- Pure spam or promotional content with no informational value

You must respond with valid JSON in this exact format:
{
  "chainOfThought": "your reasoning here",
  "is_relevant_content": true/false
}

---`;
