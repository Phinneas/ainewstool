import { DOMAIN_SOURCE_MAP } from "./feeds.js";
export function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}
export function buildUploadFileName(isoDate, title, sourceName) {
    const datePrefix = isoDate.substring(0, 10);
    return `${datePrefix}/${slugify(title)}.${sourceName}`;
}
export function extractDomainSourceName(url) {
    const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/]+)/i);
    if (!match)
        throw new Error(`Unable to extract domain from url: ${url}`);
    const domain = match[1];
    return domain
        .replace(/^www\./, "")
        .replace(/\.[^.]+$/, "")
        .replace(/\./g, "-");
}
export function resolveGoogleNewsSourceName(url) {
    const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/]+)/i);
    if (!match)
        return extractDomainSourceName(url);
    const domain = match[1];
    return DOMAIN_SOURCE_MAP[domain] ?? extractDomainSourceName(url);
}
export function normalizeRssItem(item, sourceName, feedType, feedUrl) {
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
export function normalizeJsonFeedItem(item, sourceName, feedType, feedUrl) {
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
export function normalizeGoogleNewsItem(item, feedUrl) {
    const url = item.url ?? "";
    const sourceName = resolveGoogleNewsSourceName(url);
    return normalizeJsonFeedItem(item, sourceName, "article", feedUrl);
}
export function normalizeRedditItem(item, feedUrl) {
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
export function normalizeSearchResult(item) {
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
