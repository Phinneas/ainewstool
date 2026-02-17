import { describe, it, expect } from "vitest";
import { assembleNewsletter } from "../src/generate/assemble.js";

describe("assembleNewsletter", () => {
  it("assembles all sections into the correct markdown structure", () => {
    const result = assembleNewsletter({
      subjectLine: "OpenAI's new reasoning model arrives",
      preHeaderText: "PLUS: Google's Gemini update and more",
      intro: "**Good morning, {{first_name | AI enthusiast}}.**\n\nBig news today.",
      storySections: ["# Story One\n\nContent here.", "# Story Two\n\nMore content."],
      shortlist: "**NVIDIA** [released](https://example.com) a new chip.",
    });

    expect(result).toContain("# OpenAI's new reasoning model arrives");
    expect(result).toContain("PLUS: Google's Gemini update and more");
    expect(result).toContain("Good morning, {{first_name | AI enthusiast}}");
    expect(result).toContain("# Story One");
    expect(result).toContain("# Story Two");
    expect(result).toContain("## The Quick Scribbles");
    expect(result).toContain("**NVIDIA** [released]");
  });

  it("separates story sections with horizontal rules", () => {
    const result = assembleNewsletter({
      subjectLine: "Test",
      preHeaderText: "Test",
      intro: "Intro",
      storySections: ["Section A", "Section B", "Section C"],
      shortlist: "Shortlist",
    });

    // Story sections are joined with ---
    const sectionBlock = result.split("## The Quick Scribbles")[0];
    const separators = sectionBlock.match(/---/g);
    // Should have: after preheader, after intro, between sections (2), before shortlist
    expect(separators!.length).toBeGreaterThanOrEqual(4);
  });

  it("uses the subject line as the top-level heading", () => {
    const result = assembleNewsletter({
      subjectLine: "AI finds cancers with 99% accuracy",
      preHeaderText: "PLUS: more",
      intro: "Hello",
      storySections: ["Content"],
      shortlist: "List",
    });

    const firstLine = result.split("\n")[0];
    expect(firstLine).toBe("# AI finds cancers with 99% accuracy");
  });

  it("handles single story section", () => {
    const result = assembleNewsletter({
      subjectLine: "Single Story",
      preHeaderText: "Just one",
      intro: "Intro text",
      storySections: ["The only story"],
      shortlist: "Extra items",
    });

    expect(result).toContain("The only story");
    expect(result).toContain("## The Quick Scribbles");
  });

  it("handles empty shortlist gracefully", () => {
    const result = assembleNewsletter({
      subjectLine: "Test",
      preHeaderText: "Test",
      intro: "Intro",
      storySections: ["Story"],
      shortlist: "",
    });

    expect(result).toContain("## The Quick Scribbles");
  });
});
