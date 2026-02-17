import { describe, it, expect } from "vitest";
import {
  NEWSLETTER_FEEDS,
  JSON_FEEDS,
  REDDIT_FEEDS,
  BLOG_FEEDS,
  ALL_FEEDS,
  DOMAIN_SOURCE_MAP,
} from "../src/ingest/feeds.js";

describe("feed definitions (loaded from feeds.json)", () => {
  it("has 6 newsletter feeds", () => {
    expect(NEWSLETTER_FEEDS).toHaveLength(6);
  });

  it("has 2 JSON feeds (Google News, Hacker News)", () => {
    expect(JSON_FEEDS).toHaveLength(2);
    expect(JSON_FEEDS.map((f) => f.name)).toContain("google_news");
    expect(JSON_FEEDS.map((f) => f.name)).toContain("hacker_news");
  });

  it("has 3 Reddit feeds", () => {
    expect(REDDIT_FEEDS).toHaveLength(3);
  });

  it("has 6 blog feeds", () => {
    expect(BLOG_FEEDS).toHaveLength(6);
  });

  it("ALL_FEEDS contains all feeds combined", () => {
    expect(ALL_FEEDS).toHaveLength(
      NEWSLETTER_FEEDS.length +
        JSON_FEEDS.length +
        REDDIT_FEEDS.length +
        BLOG_FEEDS.length
    );
  });

  it("all newsletter feeds have feedType 'newsletter'", () => {
    for (const feed of NEWSLETTER_FEEDS) {
      expect(feed.feedType).toBe("newsletter");
    }
  });

  it("all blog feeds have feedType 'article'", () => {
    for (const feed of BLOG_FEEDS) {
      expect(feed.feedType).toBe("article");
    }
  });

  it("all reddit feeds have feedType 'subreddit'", () => {
    for (const feed of REDDIT_FEEDS) {
      expect(feed.feedType).toBe("subreddit");
    }
  });

  it("all reddit feeds have a subreddit name", () => {
    for (const feed of REDDIT_FEEDS) {
      expect(feed.subreddit).toBeDefined();
      expect(feed.subreddit!.length).toBeGreaterThan(0);
    }
  });

  it("all feeds have unique names", () => {
    const names = ALL_FEEDS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("all feeds have unique source names", () => {
    const sourceNames = ALL_FEEDS.map((f) => f.sourceName);
    expect(new Set(sourceNames).size).toBe(sourceNames.length);
  });

  it("all feeds have a valid format", () => {
    for (const feed of ALL_FEEDS) {
      expect(["rss", "json"]).toContain(feed.format);
    }
  });

  it("all feeds have non-empty feedUrl", () => {
    for (const feed of ALL_FEEDS) {
      expect(feed.feedUrl.length).toBeGreaterThan(0);
    }
  });

  it("all feeds have a category matching their array", () => {
    for (const feed of NEWSLETTER_FEEDS) expect(feed.category).toBe("newsletter");
    for (const feed of JSON_FEEDS) expect(feed.category).toBe("json");
    for (const feed of REDDIT_FEEDS) expect(feed.category).toBe("reddit");
    for (const feed of BLOG_FEEDS) expect(feed.category).toBe("blog");
  });

  it("all feeds are enabled (since all defaults are true)", () => {
    for (const feed of ALL_FEEDS) {
      expect(feed.enabled).toBe(true);
    }
  });
});

describe("domain source map (loaded from feeds.json)", () => {
  it("has at least 20 domain mappings", () => {
    expect(Object.keys(DOMAIN_SOURCE_MAP).length).toBeGreaterThanOrEqual(20);
  });

  it("maps known domains correctly", () => {
    expect(DOMAIN_SOURCE_MAP["techcrunch.com"]).toBe("techcrunch");
    expect(DOMAIN_SOURCE_MAP["theverge.com"]).toBe("the-verge");
    expect(DOMAIN_SOURCE_MAP["reuters.com"]).toBe("reuters");
    expect(DOMAIN_SOURCE_MAP["nytimes.com"]).toBe("the-new-york-times");
  });
});
