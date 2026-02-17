import { describe, it, expect } from "vitest";
import {
  slugify,
  buildUploadFileName,
  extractDomainSourceName,
  resolveGoogleNewsSourceName,
  normalizeRssItem,
  normalizeJsonFeedItem,
  normalizeGoogleNewsItem,
  normalizeRedditItem,
} from "../src/ingest/normalize.js";

describe("slugify", () => {
  it("converts text to lowercase hyphenated slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("OpenAI's GPT-4.1: A New Era!")).toBe(
      "openais-gpt-41-a-new-era"
    );
  });

  it("collapses multiple spaces into single hyphen", () => {
    expect(slugify("too   many   spaces")).toBe("too-many-spaces");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("double--hyphen---test")).toBe("double-hyphen-test");
  });

  it("trims leading and trailing whitespace", () => {
    expect(slugify("  padded  ")).toBe("padded");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});

describe("buildUploadFileName", () => {
  it("combines date prefix, slugified title, and source name", () => {
    const result = buildUploadFileName(
      "2026-02-10T12:00:00Z",
      "OpenAI Releases GPT-5",
      "techcrunch"
    );
    expect(result).toBe("2026-02-10/openai-releases-gpt-5.techcrunch");
  });

  it("uses only first 10 chars of ISO date", () => {
    const result = buildUploadFileName(
      "2026-01-15T08:30:00.000Z",
      "Test",
      "source"
    );
    expect(result).toMatch(/^2026-01-15\//);
  });
});

describe("extractDomainSourceName", () => {
  it("extracts domain without TLD", () => {
    expect(extractDomainSourceName("https://techcrunch.com/article")).toBe(
      "techcrunch"
    );
  });

  it("strips www prefix", () => {
    expect(extractDomainSourceName("https://www.forbes.com/article")).toBe(
      "forbes"
    );
  });

  it("handles subdomains with hyphens", () => {
    expect(extractDomainSourceName("https://blog.openai.com/post")).toBe(
      "blog-openai"
    );
  });

  it("throws on invalid URL", () => {
    expect(() => extractDomainSourceName("")).toThrow(
      "Unable to extract domain"
    );
  });
});

describe("resolveGoogleNewsSourceName", () => {
  it("resolves known domains to friendly names", () => {
    expect(resolveGoogleNewsSourceName("https://techcrunch.com/article")).toBe(
      "techcrunch"
    );
    expect(
      resolveGoogleNewsSourceName("https://www.theverge.com/2026/post")
    ).toBe("the-verge");
    expect(resolveGoogleNewsSourceName("https://www.reuters.com/tech")).toBe(
      "reuters"
    );
  });

  it("falls back to domain extraction for unknown domains", () => {
    expect(
      resolveGoogleNewsSourceName("https://www.unknownsite.com/article")
    ).toBe("unknownsite");
  });
});

describe("normalizeRssItem", () => {
  it("normalizes a complete RSS item", () => {
    const result = normalizeRssItem(
      {
        title: "Test Article",
        link: "https://example.com/article",
        creator: "Author Name",
        isoDate: "2026-02-10T12:00:00Z",
      },
      "example",
      "newsletter",
      "https://example.com/feed"
    );

    expect(result.title).toBe("Test Article");
    expect(result.url).toBe("https://example.com/article");
    expect(result.authors).toBe("Author Name");
    expect(result.sourceName).toBe("example");
    expect(result.feedType).toBe("newsletter");
    expect(result.feedUrl).toBe("https://example.com/feed");
    expect(result.publishedTimestamp).toBe("2026-02-10T12:00:00Z");
    expect(result.uploadFileName).toContain("2026-02-10/");
  });

  it("uses defaults for missing fields", () => {
    const result = normalizeRssItem({}, "src", "article", "feed-url");
    expect(result.title).toBe("Untitled");
    expect(result.url).toBe("");
    expect(result.authors).toBe("");
  });

  it("falls back from isoDate to pubDate", () => {
    const result = normalizeRssItem(
      { pubDate: "Mon, 10 Feb 2026 12:00:00 GMT" },
      "src",
      "article",
      "feed"
    );
    expect(result.publishedTimestamp).toBe("Mon, 10 Feb 2026 12:00:00 GMT");
  });
});

describe("normalizeJsonFeedItem", () => {
  it("normalizes a complete JSON feed item", () => {
    const result = normalizeJsonFeedItem(
      {
        title: "JSON Article",
        url: "https://example.com/json-article",
        authors: [{ name: "Jane Doe" }],
        date_published: "2026-02-10T08:00:00Z",
      },
      "example",
      "article",
      "https://example.com/json-feed"
    );

    expect(result.title).toBe("JSON Article");
    expect(result.url).toBe("https://example.com/json-article");
    expect(result.authors).toBe("Jane Doe");
    expect(result.publishedTimestamp).toBe("2026-02-10T08:00:00Z");
  });

  it("uses defaults for missing fields", () => {
    const result = normalizeJsonFeedItem({}, "src", "article", "feed");
    expect(result.title).toBe("Untitled");
    expect(result.url).toBe("");
    expect(result.authors).toBe("");
  });
});

describe("normalizeGoogleNewsItem", () => {
  it("resolves source name from known domain", () => {
    const result = normalizeGoogleNewsItem(
      {
        title: "AI Breakthrough",
        url: "https://www.reuters.com/technology/ai-breakthrough",
        date_published: "2026-02-10T10:00:00Z",
      },
      "https://news.google.com/rss"
    );

    expect(result.sourceName).toBe("reuters");
    expect(result.feedType).toBe("article");
  });
});

describe("normalizeRedditItem", () => {
  it("normalizes a reddit item with epoch timestamp", () => {
    const result = normalizeRedditItem(
      {
        title: "Cool AI Post",
        url: "https://techcrunch.com/cool-post",
        created_utc: 1770681600, // 2026-02-10T12:00:00Z
      },
      "https://reddit.com/r/OpenAI"
    );

    expect(result.title).toBe("Cool AI Post");
    expect(result.url).toBe("https://techcrunch.com/cool-post");
    expect(result.feedType).toBe("subreddit");
    expect(result.sourceName).toBe("techcrunch");
    expect(result.publishedTimestamp).toContain("2026");
  });
});
