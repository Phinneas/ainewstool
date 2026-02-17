import { describe, it, expect } from "vitest";
import { z } from "zod/v4";

/**
 * These tests validate the JSON parsing logic used across all generation modules.
 * Each module extracts JSON from LLM responses using the same regex pattern,
 * then validates with Zod schemas. We test the parsing and validation independently
 * of the LLM calls.
 */

// Shared JSON extraction helper (mirrors what each module does)
function extractJson(response: string): unknown | null {
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return JSON.parse(match[0]);
}

describe("LLM response JSON extraction", () => {
  it("extracts JSON from a clean response", () => {
    const response = '{"key": "value"}';
    expect(extractJson(response)).toEqual({ key: "value" });
  });

  it("extracts JSON wrapped in markdown code block", () => {
    const response = '```json\n{"key": "value"}\n```';
    expect(extractJson(response)).toEqual({ key: "value" });
  });

  it("extracts JSON with surrounding text", () => {
    const response =
      'Here is my response:\n\n{"key": "value"}\n\nHope that helps!';
    expect(extractJson(response)).toEqual({ key: "value" });
  });

  it("returns null for response with no JSON", () => {
    expect(extractJson("No JSON here at all")).toBeNull();
  });

  it("handles nested JSON objects", () => {
    const response = '{"outer": {"inner": "value"}, "list": [1, 2, 3]}';
    const result = extractJson(response) as Record<string, unknown>;
    expect(result.outer).toEqual({ inner: "value" });
    expect(result.list).toEqual([1, 2, 3]);
  });
});

describe("story selection schema", () => {
  const StorySelectionSchema = z.object({
    top_selected_stories_chain_of_thought: z.string(),
    top_selected_stories: z.array(
      z.object({
        title: z.string(),
        summary: z.string(),
        identifiers: z.array(z.string()),
        external_source_links: z.array(z.string()),
      })
    ),
  });

  it("validates a well-formed story selection response", () => {
    const data = {
      top_selected_stories_chain_of_thought: "I selected these because...",
      top_selected_stories: [
        {
          title: "OpenAI Launches GPT-5",
          summary: "OpenAI released its next-gen model",
          identifiers: ["2026-02-10/openai-gpt5.techcrunch"],
          external_source_links: ["https://openai.com/blog/gpt5"],
        },
        {
          title: "Google Gemini Update",
          summary: "Google released Gemini 2.5",
          identifiers: ["2026-02-10/gemini-update.the-verge"],
          external_source_links: [],
        },
      ],
    };

    const result = StorySelectionSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects response missing chain of thought", () => {
    const data = {
      top_selected_stories: [
        {
          title: "Test",
          summary: "Test",
          identifiers: [],
          external_source_links: [],
        },
      ],
    };

    const result = StorySelectionSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects story missing required fields", () => {
    const data = {
      top_selected_stories_chain_of_thought: "reasoning",
      top_selected_stories: [{ title: "Only title" }],
    };

    const result = StorySelectionSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("subject line schema", () => {
  const SubjectLineSchema = z.object({
    subject_line_reasoning: z.string().optional(),
    subject_line: z.string(),
    additional_subject_lines: z.array(z.string()),
    pre_header_text_reasoning: z.string().optional(),
    pre_header_text: z.string(),
  });

  it("validates a well-formed subject line response", () => {
    const data = {
      subject_line_reasoning: "I chose this because...",
      subject_line: "OpenAI's new reasoning model arrives",
      additional_subject_lines: ["Alt 1", "Alt 2", "Alt 3"],
      pre_header_text_reasoning: "The pre-header teases...",
      pre_header_text: "PLUS: Google's Gemini and NVIDIA robots",
    };

    const result = SubjectLineSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("validates with optional fields omitted", () => {
    const data = {
      subject_line: "Test subject line",
      additional_subject_lines: [],
      pre_header_text: "PLUS: other stuff",
    };

    const result = SubjectLineSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects response missing subject_line", () => {
    const data = {
      additional_subject_lines: ["alt"],
      pre_header_text: "PLUS: test",
    };

    const result = SubjectLineSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("section schema", () => {
  const SectionSchema = z.object({
    chainOfThought: z.string(),
    newsletter_section_content: z.string(),
  });

  it("validates a well-formed section response", () => {
    const data = {
      chainOfThought: "I structured this section by...",
      newsletter_section_content:
        "# OpenAI Launches GPT-5\n\n**The Scoop:** ...",
    };

    const result = SectionSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects response missing chainOfThought", () => {
    const data = {
      newsletter_section_content: "content only",
    };

    const result = SectionSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("intro schema", () => {
  const IntroSchema = z.object({
    chainOfThought: z.string().optional(),
    newsletter_intro_section_content: z.string(),
  });

  it("validates a well-formed intro response", () => {
    const data = {
      chainOfThought: "reasoning here",
      newsletter_intro_section_content:
        "**Good morning, {{first_name | AI enthusiast}}.**\n\nBig news.",
    };

    const result = IntroSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("validates with optional chainOfThought omitted", () => {
    const data = {
      newsletter_intro_section_content: "intro content",
    };

    const result = IntroSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects response missing intro content", () => {
    const data = {
      chainOfThought: "only reasoning",
    };

    const result = IntroSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("shortlist schema", () => {
  const ShortlistSchema = z.object({
    chainOfThought: z.string().optional(),
    newsletter_other_top_stories_section_content: z.string(),
  });

  it("validates a well-formed shortlist response", () => {
    const data = {
      chainOfThought: "I selected these stories because...",
      newsletter_other_top_stories_section_content:
        "**NVIDIA** [released](https://example.com) a new chip.",
    };

    const result = ShortlistSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("validates with optional chainOfThought omitted", () => {
    const data = {
      newsletter_other_top_stories_section_content: "shortlist content",
    };

    const result = ShortlistSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects response missing shortlist content", () => {
    const data = {
      chainOfThought: "reasoning only",
    };

    const result = ShortlistSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});
