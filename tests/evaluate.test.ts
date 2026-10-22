import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for stage-3 relevance evaluation.
 *
 * Two providers are covered: the Mistral chat path (JSON parse + validation)
 * and the Jev path (typed decisions, no text output). Provider is selected via
 * the explicit `provider` option so these never depend on ambient env.
 */

vi.mock("../src/llm/mistral.js", () => ({
  chatWithMistral: vi.fn(),
}));

// Keep the real error classes so `instanceof JevPayloadTooLargeError` works in
// the retry tests, while stubbing only the network call.
vi.mock("../src/llm/jev.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/llm/jev.js")>();
  return { ...actual, decide: vi.fn() };
});

vi.mock("../src/config.js", () => ({
  config: {
    mistral: { apiKey: "test-key" },
    anthropic: { apiKey: "test-key", model: "" },
    openrouter: { apiKey: "test-key" },
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

import {
  evaluateContentRelevance,
  detectContentType,
  boundForState,
  acceptNews,
  combineResearchScore,
  DEFAULT_CHAR_BUDGET,
} from "../src/ingest/evaluate.js";
import { chatWithMistral } from "../src/llm/mistral.js";
import { decide, JevPayloadTooLargeError } from "../src/llm/jev.js";

const mockChatWithMistral = vi.mocked(chatWithMistral);
const mockDecide = vi.mocked(decide);

const THRESHOLD = 0.35;
const jevOpts = { provider: "jev" as const, threshold: THRESHOLD };

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Mistral path — unchanged behaviour
// ---------------------------------------------------------------------------

describe("evaluateContentRelevance (mistral)", () => {
  it("returns isRelevant=true for relevant content", async () => {
    mockChatWithMistral.mockResolvedValueOnce(
      JSON.stringify({
        chainOfThought: "This is about a new AI model release",
        is_relevant_content: true,
      })
    );

    const result = await evaluateContentRelevance("OpenAI released GPT-5...", "news", {
      provider: "mistral",
    });
    expect(result.isRelevant).toBe(true);
    expect(result.reasoning).toContain("AI model");
    expect(result.provider).toBe("mistral");
  });

  it("returns isRelevant=false for irrelevant content", async () => {
    mockChatWithMistral.mockResolvedValueOnce(
      JSON.stringify({
        chainOfThought: "This is a cooking recipe",
        is_relevant_content: false,
      })
    );

    const result = await evaluateContentRelevance("How to make chocolate cake...", "news", {
      provider: "mistral",
    });
    expect(result.isRelevant).toBe(false);
  });

  it("returns isRelevant=false when JSON extraction fails", async () => {
    mockChatWithMistral.mockResolvedValueOnce("No JSON here, just text");

    const result = await evaluateContentRelevance("some content", "news", { provider: "mistral" });
    expect(result.isRelevant).toBe(false);
    // The full message is "Failed to parse LLM response".
    expect(result.reasoning).toContain("Failed to parse LLM response");
  });

  it("returns isRelevant=false when LLM returns malformed JSON", async () => {
    mockChatWithMistral.mockResolvedValueOnce("{invalid json}}}");

    const result = await evaluateContentRelevance("some content", "news", { provider: "mistral" });
    expect(result.isRelevant).toBe(false);
  });

  it("handles response wrapped in markdown code block", async () => {
    mockChatWithMistral.mockResolvedValueOnce(
      '```json\n{"chainOfThought": "AI related", "is_relevant_content": true}\n```'
    );

    const result = await evaluateContentRelevance("AI content", "news", { provider: "mistral" });
    expect(result.isRelevant).toBe(true);
  });

  it("defaults isRelevant to false when field is missing", async () => {
    mockChatWithMistral.mockResolvedValueOnce(
      JSON.stringify({ chainOfThought: "no verdict given" })
    );

    const result = await evaluateContentRelevance("some content", "news", { provider: "mistral" });
    expect(result.isRelevant).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pure functions — no mocking needed
// ---------------------------------------------------------------------------

describe("boundForState", () => {
  it("passes content through untouched when within budget", () => {
    const b = boundForState("short article", 1000);
    expect(b.text).toBe("short article");
    expect(b.truncated).toBe(false);
    expect(b.originalChars).toBe(13);
  });

  it("cuts at a paragraph boundary when one is available", () => {
    const content = `${"A".repeat(600)}\n\n${"B".repeat(600)}`;
    const b = boundForState(content, 1000);
    expect(b.truncated).toBe(true);
    expect(b.text.endsWith("A".repeat(10))).toBe(true);
    expect(b.text).not.toContain("B");
    expect(b.originalChars).toBe(content.length);
  });

  it("hard-cuts when the only paragraph break would discard too much", () => {
    const content = `${"A".repeat(100)}\n\n${"B".repeat(2000)}`;
    const b = boundForState(content, 1000);
    expect(b.truncated).toBe(true);
    expect(b.text.length).toBe(1000);
  });
});

describe("acceptNews (three-band threshold)", () => {
  const tag = (choice: string, confidence?: number) =>
    ({ type: "choice", choice, confidence, probabilities: {} }) as never;

  it("accepts above the upper band", () => {
    expect(acceptNews(0.9, tag("belongs"), THRESHOLD)).toBe(true);
  });

  it("rejects below the lower band", () => {
    expect(acceptNews(0.1, tag("off_topic", 0.9), THRESHOLD)).toBe(false);
  });

  it("rejects inside the uncertain band on a confident rejection tag", () => {
    // 0.40 is inside [threshold-0.15, threshold+0.15] = [0.20, 0.50]
    expect(acceptNews(0.4, tag("job_posting", 0.91), THRESHOLD)).toBe(false);
  });

  it("accepts inside the uncertain band when the tag says it belongs", () => {
    expect(acceptNews(0.4, tag("belongs", 0.91), THRESHOLD)).toBe(true);
  });

  it("accepts inside the uncertain band when the tag is not confident", () => {
    expect(acceptNews(0.4, tag("off_topic", 0.3), THRESHOLD)).toBe(true);
  });

  it("leans accept when there is no tag answer at all", () => {
    // noul carries no confidence of its own, so a missing tag must not block.
    expect(acceptNews(0.4, undefined, THRESHOLD)).toBe(true);
  });

  it("is biased below 0.5 — the old prompt said 'be reasonably inclusive'", () => {
    // A neutral 0.5 cut would reject this; the deliberate lean accepts it.
    expect(acceptNews(0.55, tag("off_topic", 0.2), 0.5)).toBe(true);
    expect(acceptNews(0.4, undefined, THRESHOLD)).toBe(true);
  });
});

describe("combineResearchScore", () => {
  it("maps all-max axes to 10", () => {
    expect(combineResearchScore({ accessibility: 4, novelty: 4, relevance: 4 })).toBe(10);
  });

  it("maps all-min axes to 1", () => {
    expect(combineResearchScore({ accessibility: 0, novelty: 0, relevance: 0 })).toBe(1);
  });

  it("stays on the 1-10 scale so score >= 4 and score / 10 keep working", () => {
    const mid = combineResearchScore({ accessibility: 2, novelty: 2, relevance: 2 });
    expect(mid).toBeGreaterThanOrEqual(1);
    expect(mid).toBeLessThanOrEqual(10);
    expect(mid).toBeGreaterThanOrEqual(4); // mid-scale must still pass the gate
  });

  it("weights accessibility above relevance", () => {
    const accHeavy = combineResearchScore({ accessibility: 4, novelty: 0, relevance: 0 });
    const relHeavy = combineResearchScore({ accessibility: 0, novelty: 0, relevance: 4 });
    expect(accHeavy).toBeGreaterThan(relHeavy);
  });

  it("clamps out-of-range axis values", () => {
    expect(combineResearchScore({ accessibility: 99, novelty: -5, relevance: 4 })).toBeLessThanOrEqual(10);
    expect(combineResearchScore({ accessibility: 99, novelty: -5, relevance: 4 })).toBeGreaterThanOrEqual(1);
  });
});

describe("detectContentType", () => {
  it("routes arxiv to research", () => {
    expect(detectContentType({ url: "https://arxiv.org/abs/2401.00001" })).toBe("research");
  });
  it("routes github to project", () => {
    expect(detectContentType({ url: "https://github.com/foo/bar" })).toBe("project");
  });
  it("defaults to news", () => {
    expect(detectContentType({ url: "https://example.com/post" })).toBe("news");
  });
});

// ---------------------------------------------------------------------------
// Jev path
// ---------------------------------------------------------------------------

describe("evaluateContentRelevance (jev, news)", () => {
  it("accepts a clear yes and surfaces the probability", async () => {
    mockDecide.mockResolvedValueOnce({
      answers: {
        is_relevant: { type: "noul", noul: 0.96 },
        rejection_tag: { type: "choice", choice: "belongs", confidence: 0.88, probabilities: {} },
      },
      usage: { input_tokens: 1200, output_tokens: 40, cost: 0.00005 },
    });

    const result = await evaluateContentRelevance("New open-weight model released", "news", jevOpts);

    expect(result.isRelevant).toBe(true);
    expect(result.probability).toBe(0.96);
    expect(result.rejectionTag).toBeUndefined();
    expect(result.provider).toBe("jev");
    expect(result.reasoning).toContain("noul=0.960");
    expect(result.usage?.inputTokens).toBe(1200);
    expect(result.usage?.cost).toBe(0.00005);
  });

  it("rejects a clear no and records the rejection tag", async () => {
    mockDecide.mockResolvedValueOnce({
      answers: {
        is_relevant: { type: "noul", noul: 0.03 },
        rejection_tag: { type: "choice", choice: "job_posting", confidence: 0.94, probabilities: {} },
      },
      usage: { input_tokens: 900 },
    });

    const result = await evaluateContentRelevance("Senior ML Engineer wanted", "news", jevOpts);

    expect(result.isRelevant).toBe(false);
    expect(result.rejectionTag).toBe("job_posting");
    expect(result.confidence).toBe(0.94);
    expect(result.reasoning).toContain("tag=job_posting");
  });

  it("never sends the article text inside the question instructions", async () => {
    mockDecide.mockResolvedValueOnce({
      answers: { is_relevant: { type: "noul", noul: 0.9 } },
      usage: {},
    });

    await evaluateContentRelevance("UNIQUE_MARKER_TEXT", "news", jevOpts);

    const call = mockDecide.mock.calls[0][0];
    // Content travels in `state`, not duplicated into every question.
    expect((call.state as { content: string }).content).toBe("UNIQUE_MARKER_TEXT");
    expect(JSON.stringify(call.questions)).not.toContain("UNIQUE_MARKER_TEXT");
    expect(call.questions.rejection_tag.type).toBe("choice");
  });

  it("throws when Jev returns no noul answer", async () => {
    mockDecide.mockResolvedValueOnce({ answers: {}, usage: {} });

    await expect(
      evaluateContentRelevance("content", "news", jevOpts)
    ).rejects.toThrow(/no is_relevant answer/);
  });

  it("does not expose a confidence for the noul answer itself", async () => {
    // noul answers carry no confidence — only choice/score do. With no tag
    // answer at all, confidence must be undefined rather than 0 or a guess.
    mockDecide.mockResolvedValueOnce({
      answers: { is_relevant: { type: "noul", noul: 0.8 } },
      usage: {},
    });

    const result = await evaluateContentRelevance("content", "news", jevOpts);
    expect(result.probability).toBe(0.8);
    expect(result.confidence).toBeUndefined();
  });

  it("bounds oversized content and flags the truncation", async () => {
    mockDecide.mockResolvedValueOnce({
      answers: { is_relevant: { type: "noul", noul: 0.9 } },
      usage: { input_tokens: 50 },
    });

    const huge = "x".repeat(5000);
    const result = await evaluateContentRelevance(huge, "news", {
      ...jevOpts,
      charBudget: 1000,
    });

    expect(result.truncated).toBe(true);
    const sent = (mockDecide.mock.calls[0][0].state as { content: string }).content;
    expect(sent.length).toBeLessThanOrEqual(1000);
  });

  it("does not flag truncation for content within budget", async () => {
    mockDecide.mockResolvedValueOnce({
      answers: { is_relevant: { type: "noul", noul: 0.9 } },
      usage: {},
    });

    const result = await evaluateContentRelevance("short", "news", jevOpts);
    expect(result.truncated).toBe(false);
  });

  it("retries once at half the budget on 413", async () => {
    mockDecide
      .mockRejectedValueOnce(new JevPayloadTooLargeError("payload too large"))
      .mockResolvedValueOnce({
        answers: { is_relevant: { type: "noul", noul: 0.7 } },
        usage: { input_tokens: 20 },
      });

    const result = await evaluateContentRelevance("y".repeat(4000), "news", {
      ...jevOpts,
      charBudget: 2000,
    });

    expect(mockDecide).toHaveBeenCalledTimes(2);
    expect(result.isRelevant).toBe(true);
    // Second attempt got half the budget.
    const second = (mockDecide.mock.calls[1][0].state as { content: string }).content;
    expect(second.length).toBeLessThanOrEqual(1000);
  });

  it("propagates when the halved retry also 413s", async () => {
    mockDecide
      .mockRejectedValueOnce(new JevPayloadTooLargeError("too large"))
      .mockRejectedValueOnce(new JevPayloadTooLargeError("still too large"));

    await expect(
      evaluateContentRelevance("z".repeat(4000), "news", { ...jevOpts, charBudget: 2000 })
    ).rejects.toBeInstanceOf(JevPayloadTooLargeError);
    expect(mockDecide).toHaveBeenCalledTimes(2);
  });
});

describe("evaluateContentRelevance (jev, research)", () => {
  it("combines the three weighted axes onto the 1-10 scale", async () => {
    mockDecide.mockResolvedValueOnce({
      answers: {
        accessibility: { type: "score", score: 4, confidence: 0.8, probabilities: {} },
        novelty: { type: "score", score: 3, confidence: 0.7, probabilities: {} },
        relevance: { type: "score", score: 4, confidence: 0.9, probabilities: {} },
      },
      usage: { input_tokens: 3000, cost: 0.0001 },
    });

    const result = await evaluateContentRelevance("paper text", "research", jevOpts);

    expect(result.score).toBeGreaterThanOrEqual(8);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.isRelevant).toBe(true);
    expect(result.provider).toBe("jev");
    expect(result.reasoning).toContain("acc=4.00");
  });

  it("rejects a low-scoring paper below the >= 4 gate", async () => {
    mockDecide.mockResolvedValueOnce({
      answers: {
        accessibility: { type: "score", score: 0, probabilities: {} },
        novelty: { type: "score", score: 0, probabilities: {} },
        relevance: { type: "score", score: 0, probabilities: {} },
      },
      usage: {},
    });

    const result = await evaluateContentRelevance("dense theory", "research", jevOpts);
    expect(result.score).toBe(1);
    expect(result.isRelevant).toBe(false);
  });

  it("asks all three rubric axes in a single request", async () => {
    mockDecide.mockResolvedValueOnce({
      answers: {
        accessibility: { type: "score", score: 2, probabilities: {} },
        novelty: { type: "score", score: 2, probabilities: {} },
        relevance: { type: "score", score: 2, probabilities: {} },
      },
      usage: {},
    });

    await evaluateContentRelevance("paper", "research", jevOpts);

    expect(mockDecide).toHaveBeenCalledTimes(1);
    const { questions } = mockDecide.mock.calls[0][0];
    expect(Object.keys(questions).sort()).toEqual(["accessibility", "novelty", "relevance"]);
  });

  it("scores a partially-answered rubric rather than failing outright", async () => {
    mockDecide.mockResolvedValueOnce({
      answers: {
        accessibility: { type: "score", score: 4, probabilities: {} },
        // novelty + relevance missing
      },
      usage: {},
    });

    const result = await evaluateContentRelevance("paper", "research", jevOpts);
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.reasoning).toContain("missing=2");
  });

  it("throws when no score answers come back at all", async () => {
    mockDecide.mockResolvedValueOnce({ answers: {}, usage: {} });

    await expect(
      evaluateContentRelevance("paper", "research", jevOpts)
    ).rejects.toThrow(/no score answers/);
  });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe("settings defaults", () => {
  it("uses a conservative char budget well inside Jev's 32K context", () => {
    // 60k chars at ~3.5 chars/token is ~17k tokens, leaving headroom for the
    // question criteria that are re-sent on every request.
    expect(DEFAULT_CHAR_BUDGET).toBe(60_000);
  });

  it("routes research URLs to the Jev score path", async () => {
    mockDecide.mockResolvedValueOnce({
      answers: {
        accessibility: { type: "score", score: 4, probabilities: {} },
        novelty: { type: "score", score: 4, probabilities: {} },
        relevance: { type: "score", score: 4, probabilities: {} },
      },
      usage: {},
    });

    const type = detectContentType({ url: "https://arxiv.org/abs/2401.00001" });
    await evaluateContentRelevance("paper", type, jevOpts);

    const { questions } = mockDecide.mock.calls[0][0];
    expect(questions.accessibility.type).toBe("score");
  });
});
