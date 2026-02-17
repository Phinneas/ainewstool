import { describe, it, expect, vi } from "vitest";

/**
 * Tests for the evaluation result parsing logic.
 * We mock the LLM call and test that the parsing/validation works correctly.
 */

// Mock the mistral module before importing evaluate
vi.mock("../src/llm/mistral.js", () => ({
  chatWithMistral: vi.fn(),
}));

// Mock the config module to avoid requiring env vars
vi.mock("../src/config.js", () => ({
  config: {
    mistral: { apiKey: "test-key" },
    anthropic: { apiKey: "test-key" },
    moonshot: { apiKey: "test-key" },
    firecrawl: { apiKey: "test-key" },
    s3: {
      endpoint: "https://test.r2.cloudflarestorage.com",
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "test",
      region: "auto",
    },
    reddit: { clientId: "", clientSecret: "" },
  },
}));

import { evaluateContentRelevance } from "../src/ingest/evaluate.js";
import { chatWithMistral } from "../src/llm/mistral.js";

const mockChatWithMistral = vi.mocked(chatWithMistral);

describe("evaluateContentRelevance", () => {
  it("returns isRelevant=true for relevant content", async () => {
    mockChatWithMistral.mockResolvedValueOnce(
      JSON.stringify({
        chainOfThought: "This is about a new AI model release",
        is_relevant_content: true,
      })
    );

    const result = await evaluateContentRelevance("OpenAI released GPT-5...");
    expect(result.isRelevant).toBe(true);
    expect(result.reasoning).toContain("AI model");
  });

  it("returns isRelevant=false for irrelevant content", async () => {
    mockChatWithMistral.mockResolvedValueOnce(
      JSON.stringify({
        chainOfThought: "This is a cooking recipe",
        is_relevant_content: false,
      })
    );

    const result = await evaluateContentRelevance(
      "How to make chocolate cake..."
    );
    expect(result.isRelevant).toBe(false);
  });

  it("returns isRelevant=false when JSON extraction fails", async () => {
    mockChatWithMistral.mockResolvedValueOnce("No JSON here, just text");

    const result = await evaluateContentRelevance("some content");
    expect(result.isRelevant).toBe(false);
    expect(result.reasoning).toBe("Failed to parse");
  });

  it("returns isRelevant=false when LLM returns malformed JSON", async () => {
    mockChatWithMistral.mockResolvedValueOnce("{invalid json}}}");

    const result = await evaluateContentRelevance("some content");
    expect(result.isRelevant).toBe(false);
  });

  it("handles response wrapped in markdown code block", async () => {
    mockChatWithMistral.mockResolvedValueOnce(
      '```json\n{"chainOfThought": "AI related", "is_relevant_content": true}\n```'
    );

    const result = await evaluateContentRelevance("AI content");
    expect(result.isRelevant).toBe(true);
  });

  it("defaults isRelevant to false when field is missing", async () => {
    mockChatWithMistral.mockResolvedValueOnce(
      JSON.stringify({ chainOfThought: "no verdict given" })
    );

    const result = await evaluateContentRelevance("some content");
    expect(result.isRelevant).toBe(false);
  });
});
