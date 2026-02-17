import { describe, it, expect, vi } from "vitest";

vi.mock("../src/llm/mistral.js", () => ({
  chatWithMistral: vi.fn(),
}));

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

import { extractExternalSources } from "../src/ingest/extract-sources.js";
import { chatWithMistral } from "../src/llm/mistral.js";
import type { ScrapeResult } from "../src/storage/types.js";

const mockChatWithMistral = vi.mocked(chatWithMistral);

function makeScrapeResult(overrides?: Partial<ScrapeResult>): ScrapeResult {
  return {
    content: "Article about AI model release",
    mainContentImageUrls: [],
    rawHtml: "<html></html>",
    links: [
      "https://openai.com/blog/gpt5",
      "https://example.com/about",
      "https://techcrunch.com/article?ref=123",
    ],
    metadata: {
      url: "https://techcrunch.com/2026/02/10/openai-gpt5",
      title: "OpenAI Releases GPT-5",
    },
    ...overrides,
  };
}

describe("extractExternalSources", () => {
  it("returns comma-separated URLs from LLM response", async () => {
    mockChatWithMistral.mockResolvedValueOnce(
      JSON.stringify({
        external_source_urls: "https://openai.com/blog/gpt5",
      })
    );

    const result = await extractExternalSources(makeScrapeResult());
    expect(result).toBe("https://openai.com/blog/gpt5");
  });

  it("returns empty string when no external sources found", async () => {
    mockChatWithMistral.mockResolvedValueOnce(JSON.stringify({}));

    const result = await extractExternalSources(makeScrapeResult());
    expect(result).toBe("");
  });

  it("returns empty string when JSON parsing fails", async () => {
    mockChatWithMistral.mockResolvedValueOnce("Not JSON at all");

    const result = await extractExternalSources(makeScrapeResult());
    expect(result).toBe("");
  });

  it("strips query params from links before sending to LLM", async () => {
    mockChatWithMistral.mockResolvedValueOnce(JSON.stringify({}));

    await extractExternalSources(makeScrapeResult());

    // Check that the prompt sent to the LLM has query params stripped
    const callArgs = mockChatWithMistral.mock.calls[0][0];
    expect(callArgs.prompt).toContain("https://techcrunch.com/article");
    expect(callArgs.prompt).not.toContain("?ref=123");
  });

  it("returns multiple URLs when LLM finds several sources", async () => {
    mockChatWithMistral.mockResolvedValueOnce(
      JSON.stringify({
        external_source_urls:
          "https://openai.com/blog/gpt5,https://arxiv.org/abs/2026.12345",
      })
    );

    const result = await extractExternalSources(makeScrapeResult());
    expect(result).toContain("openai.com");
    expect(result).toContain("arxiv.org");
  });
});
