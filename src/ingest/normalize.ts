import type { NormalizedFeedItem } from "../storage/types.js";
import { DOMAIN_SOURCE_MAP } from "./feeds.js";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function buildUploadFileName(
  isoDate: string,
  title: string,
  sourceName: string
): string {
  const datePrefix = isoDate.substring(0, 10);
  return `${datePrefix}/${slugify(title)}.${sourceName}`;
}

export function extractDomainSourceName(url: string): string {
  const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/]+)/i);
  if (!match) throw new Error(`Unable to extract domain from url: ${url}`);
  const domain = match[1];
  return domain
    .replace(/^www\./, "")
    .replace(/\.[^.]+$/, "")
    .replace(/\./g, "-");
}


export function resolveGoogleNewsSourceName(url: string): string {
  const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/]+)/i);
  if (!match) return extractDomainSourceName(url);
  const domain = match[1];
  return DOMAIN_SOURCE_MAP[domain] ?? extractDomainSourceName(url);
}

export interface RawRssItem {
  title?: string;
  link?: string;
  creator?: string;
  pubDate?: string;
  isoDate?: string;
}

export interface RawJsonFeedItem {
  title?: string;
  url?: string;
  authors?: Array<{ name?: string }>;
  date_published?: string;
}

export function normalizeRssItem(
  item: RawRssItem,
  sourceName: string,
  feedType: string,
  feedUrl: string
): NormalizedFeedItem {
  const title = item.title ?? "Untitled";
  const url = item.link ?? "";
  const isoDate = item.isoDate ?? item.pubDate ?? new Date().toISOString();

  return {
    title,
    url,
    authors: item.creator ?? "",
    publishedTimestamp: isoDate,
    sourceName,
    feedType,
    feedUrl,
    uploadFileName: buildUploadFileName(isoDate, title, sourceName),
  };
}

export function normalizeJsonFeedItem(
  item: RawJsonFeedItem,
  sourceName: string,
  feedType: string,
  feedUrl: string
): NormalizedFeedItem {
  const title = item.title ?? "Untitled";
  const url = item.url ?? "";
  const isoDate = item.date_published ?? new Date().toISOString();

  return {
    title,
    url,
    authors: item.authors?.[0]?.name ?? "",
    publishedTimestamp: isoDate,
    sourceName,
    feedType,
    feedUrl,
    uploadFileName: buildUploadFileName(isoDate, title, sourceName),
  };
}

export function normalizeGoogleNewsItem(
  item: RawJsonFeedItem,
  feedUrl: string
): NormalizedFeedItem {
  const url = item.url ?? "";
  const sourceName = resolveGoogleNewsSourceName(url);
  return normalizeJsonFeedItem(item, sourceName, "article", feedUrl);
}

export function normalizeRedditItem(
  item: { title: string; url: string; created_utc: number },
  feedUrl: string
): NormalizedFeedItem {
  const sourceName = extractDomainSourceName(item.url);
  const isoDate = new Date(item.created_utc * 1000).toISOString();
  return {
    title: item.title,
    url: item.url,
    authors: "",
    publishedTimestamp: isoDate,
    sourceName,
    feedType: "subreddit",
    feedUrl,
    uploadFileName: buildUploadFileName(isoDate, item.title, sourceName),
  };
}

export function normalizeSearchResult(
  item: { url: string; title: string; markdown: string }
): NormalizedFeedItem {
  const sourceName = extractDomainSourceName(item.url);
  const isoDate = new Date().toISOString();
  return {
    title: item.title || "Untitled",
    url: item.url,
    authors: "",
    publishedTimestamp: isoDate,
    sourceName,
    feedType: "discovered",
    feedUrl: "firecrawl-search",
    uploadFileName: buildUploadFileName(isoDate, item.title || "Untitled", sourceName),
  };
}
