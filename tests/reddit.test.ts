import { describe, it, expect } from "vitest";
import {
  extractRedditPostId,
  isAllowedRedditLink,
} from "../src/ingest/reddit.js";

describe("extractRedditPostId", () => {
  it("extracts post ID from a standard reddit URL", () => {
    expect(
      extractRedditPostId(
        "https://www.reddit.com/r/OpenAI/comments/abc123/some_post_title/"
      )
    ).toBe("abc123");
  });

  it("extracts post ID from a short URL", () => {
    expect(
      extractRedditPostId("https://reddit.com/r/AI/comments/xyz789/title")
    ).toBe("xyz789");
  });

  it("returns null for non-reddit URLs", () => {
    expect(extractRedditPostId("https://techcrunch.com/article")).toBeNull();
  });

  it("returns null for reddit URLs without comments path", () => {
    expect(extractRedditPostId("https://reddit.com/r/OpenAI/")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractRedditPostId("")).toBeNull();
  });
});

describe("isAllowedRedditLink", () => {
  it("allows valid external article links", () => {
    expect(isAllowedRedditLink("https://techcrunch.com/article")).toBe(true);
    expect(isAllowedRedditLink("https://www.theverge.com/2026/post")).toBe(
      true
    );
    expect(isAllowedRedditLink("https://arxiv.org/abs/2026.12345")).toBe(true);
  });

  it("blocks reddit.com links", () => {
    expect(
      isAllowedRedditLink("https://www.reddit.com/r/OpenAI/comments/abc")
    ).toBe(false);
  });

  it("blocks youtube.com links", () => {
    expect(
      isAllowedRedditLink("https://www.youtube.com/watch?v=abc123")
    ).toBe(false);
  });

  it("blocks youtu.be links", () => {
    expect(isAllowedRedditLink("https://youtu.be/abc123")).toBe(false);
  });

  it("blocks x.com links", () => {
    expect(isAllowedRedditLink("https://x.com/user/status/123")).toBe(false);
  });

  it("blocks github.com links", () => {
    expect(isAllowedRedditLink("https://github.com/org/repo")).toBe(false);
  });

  it("blocks i.redd.it image links", () => {
    expect(isAllowedRedditLink("https://i.redd.it/image.jpg")).toBe(false);
  });

  it("blocks v.redd.it video links", () => {
    expect(isAllowedRedditLink("https://v.redd.it/video123")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAllowedRedditLink(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isAllowedRedditLink("")).toBe(false);
  });

  it("returns false for whitespace-only string", () => {
    expect(isAllowedRedditLink("   ")).toBe(false);
  });
});
