import { chatWithMistral } from "../llm/mistral.js";
import { log } from "../logger.js";

export async function generateSearchQueries(): Promise<string[]> {
  const today = new Date().toISOString().substring(0, 10);

  const prompt = `You are an AI news researcher. Today's date is ${today}.

Generate 5-8 search queries to find the most important and interesting AI news stories from today and the past 24 hours.

Your queries should cover diverse topics including:
- New AI model releases, benchmarks, and capabilities
- AI startup funding rounds and acquisitions
- AI policy, regulation, and government actions
- Open-source AI projects and tools
- AI research breakthroughs and papers
- Major tech company AI announcements (Google, OpenAI, Anthropic, Meta, Microsoft, etc.)
- AI applications in various industries

Each query should be specific enough to return relevant results but broad enough to capture multiple stories. Use natural search language, not boolean operators.

Respond with valid JSON in this exact format:
{
  "queries": ["query 1", "query 2", "query 3"]
}`;

  const response = await chatWithMistral({ prompt, maxTokens: 1024 });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn("Failed to parse search queries from Mistral response");
      return getDefaultQueries();
    }

    const parsed = JSON.parse(jsonMatch[0]) as { queries?: string[] };
    const queries = parsed.queries;

    if (!Array.isArray(queries) || queries.length === 0) {
      log.warn("No queries returned from Mistral, using defaults");
      return getDefaultQueries();
    }

    log.info(`Generated ${queries.length} search queries`, { queries });
    return queries;
  } catch {
    log.warn("Failed to parse Mistral query response, using defaults");
    return getDefaultQueries();
  }
}

function getDefaultQueries(): string[] {
  return [
    "latest AI model release announcement today",
    "AI startup funding round 2025",
    "new open source AI tool released",
    "AI regulation policy news",
    "artificial intelligence research breakthrough",
    "OpenAI Google Anthropic Meta AI news",
  ];
}
