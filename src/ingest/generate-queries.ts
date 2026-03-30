import { chatWithMistral } from "../llm/mistral.js";
import { log } from "../logger.js";

export async function generateSearchQueries(): Promise<string[]> {
  const today = new Date().toISOString().substring(0, 10);

  const prompt = `You are an AI news and tutorial researcher. Today's date is ${today}.

Generate 8-12 search queries to find the most important AI news stories AND the best AI tutorials/guides from today and the past few days.

## News queries (generate 5-7):
- New AI model releases, benchmarks, and capabilities
- AI startup funding rounds and acquisitions
- AI policy, regulation, and government actions
- Open-source AI projects and tools
- AI research breakthroughs and papers
- Major tech company AI announcements (Google, OpenAI, Anthropic, Meta, Microsoft, etc.)
- AI applications in various industries
- Model Context Protocol (MCP) tools and integrations

## Tutorial/guide queries (generate 3-5):
- Practical tutorials on fine-tuning, training, or deploying AI models
- Step-by-step guides for building AI agents or applications
- How-to content for popular AI frameworks and tools (LangChain, LlamaIndex, HuggingFace, etc.)
- AI coding tutorials and developer guides
- Beginner-friendly AI/ML explainers and walkthroughs

Each query should be specific enough to return relevant results but broad enough to capture multiple stories. Use natural search language, not boolean operators.

Respond with valid JSON in this exact format:
{
  "queries": ["query 1", "query 2", "query 3"]
}`;

  const response = await chatWithMistral({ prompt, maxTokens: 1024, model: "mistral-small" });

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
    "Model Context Protocol MCP tools and integrations",
    "AI tutorial how to build agents guide",
    "fine-tuning LLM tutorial step by step",
    "AI coding assistant tutorial beginner guide",
  ];
}
