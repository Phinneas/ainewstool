import { chatWithMistral } from "../llm/mistral.js";
import { log } from "../logger.js";
import type { CategoryQuery } from "./types.js";

export async function generateSearchQueries(): Promise<string[]> {
  const today = new Date().toISOString().substring(0, 10);

  const prompt = `You are an AI news and tutorial researcher. Today's date is ${today}.

Generate targeted search queries across specific categories to find the most important AI developments from today and the past few days. We need queries that surface technical depth, new tools, MCP/agent developments, and research insights—not just big company announcements.

## Category 1: Model Context Protocol (MCP) & Agent Tools (generate 4-5 queries)
Focus: New MCP servers, agent skill libraries, agent frameworks, tool integrations
Example topics:
- New Model Context Protocol MCP server released this week
- Agent skill library new tools released
- MCP tool integration announcements
- AI agent framework updates (LangChain, AutoGen, CrewAI, etc.)
- New agent capabilities and tools launched

## Category 2: Research & "How AI Works" (generate 4-5 queries)
Focus: Technical research, model architectures, training techniques, ML infrastructure
Example topics:
- AI research breakthrough how models work this week
- New ML training technique paper published
- LLM architecture innovation research
- AI infrastructure scaling research paper
- Model interpretability research new findings
- Attention mechanism or transformer architecture research

## Category 3: Developer Tools & Infrastructure (generate 3-4 queries)
Focus: New developer tools, frameworks, deployment platforms, SDK releases
Example topics:
- New AI developer tool released (LangChain, LlamaIndex, etc.)
- ML infrastructure tool launch announcement
- AI framework new version released
- Developer SDK for AI models launched
- AI deployment tooling new release

## Category 4: Enterprise & Business Impact (generate 2-3 queries)
Focus: Business implications, market trends, productivity impact, funding (not big tech coverage)
Example topics:
- AI startup Series A funding round announced
- Enterprise AI adoption case study
- AI vendor contract deals announced
- Business intelligence AI tool released
- AI productivity impact business metrics

## Category 5: Big Tech (LIMIT - generate only 1-2 queries)
Focus: Only the most major announcements from OpenAI, Anthropic, Google, Meta—avoid routine updates
Example topics:
- OpenAI Anthropic Google AI major announcements today

Respond with valid JSON in this exact format:
{
  "queries": ["query 1", "query 2", "query 3"]
}

Total queries should be 14-20, distributed as specified above.`;

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
    // MCP & Agent Tools
    "new Model Context Protocol MCP server released this week",
    "agent skill library new tools released",
    "MCP tool integration announcement",
    "AI agent framework updates LangChain AutoGen CrewAI",
    "new agent capabilities and tools launched",

    // Research & How AI Works
    "AI research breakthrough how models work this week",
    "new ML training technique paper published",
    "LLM architecture innovation research",
    "AI infrastructure scaling research paper",
    "model interpretability research new findings",

    // Developer Tools & Infrastructure
    "new AI developer tool released LangChain LlamaIndex",
    "ML infrastructure tool launch announcement",
    "AI framework new version released",
    "developer SDK for AI models launched",

    // Enterprise & Business Impact
    "AI startup Series A funding round announced",
    "enterprise AI adoption case study",
    "AI productivity impact business metrics",

    // Big Tech (limited)
    "OpenAI Anthropic Google AI major announcements today",
  ];
}

// ---------------------------------------------------------------------------
// Category-based query banks
// ---------------------------------------------------------------------------

export const RESEARCH_QUERIES: string[] = [
  "AI research preprint benchmark evaluation new paper",
  "machine learning model training technique novel approach arxiv",
  "LLM architecture innovation research paper 2024 2025",
  "AI infrastructure scaling distributed training research",
  "model interpretability explainability research paper",
  "AI evaluation benchmark leaderboard new results",
];

export const STARTUP_QUERIES: string[] = [
  "AI startup tool launch -OpenAI -Google -Meta -Microsoft -Amazon -Apple",
  "AI developer tool new release indie small team -OpenAI -Google",
  "AI framework launch new product -Microsoft -Amazon -Meta",
  "new AI company product launch funding -OpenAI -Anthropic -Google",
  "AI tool release open source indie developer -big tech",
  "small team AI project launch product hunt show hn",
];

export const ENTERPRISE_QUERIES: string[] = [
  "enterprise AI adoption deployment case study",
  "AI vendor contract deal enterprise announcement",
  "AI productivity ROI business metrics study",
  "enterprise LLM deployment private cloud",
  "AI workflow automation business integration",
];

export const POLICY_QUERIES: string[] = [
  "AI regulation policy government announcement",
  "AI governance framework legislation proposal",
  "AI safety regulation compliance news",
  "AI policy impact industry technology sector",
  "AI regulation EU US China development",
];

export const CONSUMER_QUERIES: string[] = [
  "consumer AI product app new release launch",
  "AI app consumer facing new features update",
  "personal AI assistant productivity tool launch",
  "consumer AI product review hands-on",
  "AI mobile app new release features",
];

/**
 * Generate category-based search queries routed to the appropriate engine.
 */
export function generateCategoryQueries(): CategoryQuery[] {
  return [
    {
      category: "research",
      engine: "parallel-search",
      queries: RESEARCH_QUERIES,
    },
    {
      category: "startup",
      engine: "parallel-findall",
      queries: STARTUP_QUERIES,
    },
    {
      category: "enterprise",
      engine: "tavily",
      queries: ENTERPRISE_QUERIES,
    },
    {
      category: "policy",
      engine: "parallel-search",
      queries: POLICY_QUERIES,
    },
    {
      category: "consumer",
      engine: "tavily",
      queries: CONSUMER_QUERIES,
    },
  ];
}
