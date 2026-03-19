/**
 * Multi-tier web scraping with automatic fallbacks:
 * 1. Jina Reader (primary) - free, no API key, returns markdown
 * 2. Native fetch + HTML extraction (fallback) - works everywhere
 * 3. Return null (final)
 */

import { log } from "../logger.js";
import type { ScrapeResult } from "../storage/types.js";

const MAX_TIMEOUT_MS = 30000; // 30 seconds max per scrape
const JINA_READER_URL = "https://r.jina.ai/";

/**
 * Scrape a URL using multiple fallback strategies.
 * Returns null if all methods fail.
 */
export async function scrapeUrl(url: string, _apiKey?: string): Promise<ScrapeResult | null> {
  // Try Jina Reader first (most reliable, returns clean markdown)
  const jinaResult = await tryJinaReader(url);
  if (jinaResult) {
    log.debug(`Jina Reader success`, { url });
    return jinaResult;
  }

  log.warn(`Jina Reader failed, trying native fetch`, { url });

  // Fallback to native HTML fetch + extraction
  const nativeResult = await tryNativeFetch(url);
  if (nativeResult) {
    log.debug(`Native fetch success`, { url });
    return nativeResult;
  }

  log.warn(`All scraping methods failed`, { url });
  return null;
}

/**
 * Jina Reader - Free URL-to-markdown service.
 * Simply prefix any URL with https://r.jina.ai/ to get markdown.
 * No API key required, works for most content.
 */
async function tryJinaReader(url: string): Promise<ScrapeResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAX_TIMEOUT_MS);

    const response = await fetch(`${JINA_READER_URL}${encodeURIComponent(url)}`, {
      method: "GET",
      headers: {
        "Accept": "text/markdown",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      log.debug(`Jina Reader HTTP error`, { status: response.status, url });
      return null;
    }

    const markdown = await response.text();

    if (!markdown || markdown.length < 100) {
      log.debug(`Jina Reader returned empty/short content`, { length: markdown?.length ?? 0, url });
      return null;
    }

    // Extract title from first heading or first line
    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : extractTitleFromUrl(url);

    // Extract image URLs from markdown
    const imageUrls = extractImageUrls(markdown);

    return {
      content: markdown,
      mainContentImageUrls: imageUrls,
      rawHtml: "", // Jina doesn't provide raw HTML
      links: extractLinks(markdown),
      metadata: {
        url,
        title,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.debug(`Jina Reader error`, { error: errorMsg, url });
    return null;
  }
}

/**
 * Native fetch + HTML extraction fallback.
 * Fetches the raw HTML and extracts main content using simple heuristics.
 * Works in both Node.js and Cloudflare Workers.
 */
async function tryNativeFetch(url: string): Promise<ScrapeResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAX_TIMEOUT_MS);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AI-Newsletter-Bot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      log.debug(`Native fetch HTTP error`, { status: response.status, url });
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      log.debug(`Native fetch non-HTML content`, { contentType, url });
      return null;
    }

    const html = await response.text();

    if (!html || html.length < 500) {
      log.debug(`Native fetch returned empty/short HTML`, { length: html?.length ?? 0, url });
      return null;
    }

    // Extract content using simple HTML parsing
    const { content, title, imageUrls } = extractFromHtml(html, url);

    if (!content || content.length < 100) {
      log.debug(`HTML extraction returned empty/short content`, { length: content?.length ?? 0, url });
      return null;
    }

    return {
      content,
      mainContentImageUrls: imageUrls,
      rawHtml: html,
      links: extractLinksFromHtml(html),
      metadata: {
        url,
        title,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.debug(`Native fetch error`, { error: errorMsg, url });
    return null;
  }
}

/**
 * Extract main content from HTML using lightweight regex-based parsing.
 * No external dependencies - works in Workers.
 */
function extractFromHtml(html: string, url: string): { content: string; title: string; imageUrls: string[] } {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  let title = titleMatch ? decodeHtml(titleMatch[1].trim()) : extractTitleFromUrl(url);

  // Try to find article/main content
  let content = "";

  // Priority 1: Look for <article> tags
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    content = articleMatch[1];
  }

  // Priority 2: Look for main content divs with common class names
  if (!content) {
    const mainPatterns = [
      /<main[^>]*>([\s\S]*?)<\/main>/i,
      /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*class="[^"]*post[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<section[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    ];

    for (const pattern of mainPatterns) {
      const match = html.match(pattern);
      if (match && match[1].length > 500) {
        content = match[1];
        break;
      }
    }
  }

  // Priority 3: Just use body content
  if (!content) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      content = bodyMatch[1];
    }
  }

  // Convert HTML to markdown-ish format
  content = htmlToMarkdown(content);

  // Extract image URLs
  const imageUrls = extractImageUrlsFromHtml(html, url);

  return { content, title, imageUrls };
}

/**
 * Convert HTML to markdown using regex replacements.
 * Lightweight, no dependencies.
 */
function htmlToMarkdown(html: string): string {
  // Remove scripts, styles, nav, header, footer, aside
  let md = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Convert headings
  md = md
    .replace(/<h1[^>]*>([^<]+)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>([^<]+)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>([^<]+)<\/h3>/gi, "### $1\n\n")
    .replace(/<h4[^>]*>([^<]+)<\/h4>/gi, "#### $1\n\n")
    .replace(/<h5[^>]*>([^<]+)<\/h5>/gi, "##### $1\n\n")
    .replace(/<h6[^>]*>([^<]+)<\/h6>/gi, "###### $1\n\n");

  // Convert paragraphs
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, "[$2]($1)");

  // Convert bold and italic
  md = md
    .replace(/<(strong|b)[^>]*>([^<]+)<\/(strong|b)>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([^<]+)<\/(em|i)>/gi, "*$2*");

  // Convert lists
  md = md
    .replace(/<li[^>]*>([^<]+)<\/li>/gi, "- $1\n")
    .replace(/<\/?[uo]l[^>]*>/gi, "\n");

  // Convert code blocks
  md = md
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "```\n$1\n```\n\n")
    .replace(/<code[^>]*>([^<]+)<\/code>/gi, "`$1`");

  // Convert blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "> $1\n\n");

  // Convert line breaks
  md = md.replace(/<br\s*\/?>/gi, "\n");

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  md = decodeHtml(md);

  // Clean up whitespace
  md = md
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  return md;
}

/**
 * Decode common HTML entities.
 */
function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Extract image URLs from markdown.
 */
function extractImageUrls(markdown: string): string[] {
  const urls: string[] = [];
  const imgRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
  let match;
  while ((match = imgRegex.exec(markdown)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

/**
 * Extract links from markdown.
 */
function extractLinks(markdown: string): string[] {
  const urls: string[] = [];
  const linkRegex = /\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(markdown)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

/**
 * Extract image URLs from HTML, filtering for large images.
 */
function extractImageUrlsFromHtml(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    let imgUrl = match[1];

    // Skip small images (icons, avatars, tracking pixels)
    const imgTag = match[0];
    const widthMatch = imgTag.match(/width=["']?(\d+)/i);
    const heightMatch = imgTag.match(/height=["']?(\d+)/i);

    if (widthMatch && parseInt(widthMatch[1]) < 400) continue;
    if (heightMatch && parseInt(heightMatch[1]) < 300) continue;

    // Skip common icon patterns
    if (imgUrl.includes("avatar") || imgUrl.includes("icon") || imgUrl.includes("logo") || imgUrl.includes("favicon")) continue;
    if (imgUrl.endsWith(".svg")) continue;

    // Resolve relative URLs
    if (imgUrl.startsWith("//")) {
      imgUrl = "https:" + imgUrl;
    } else if (imgUrl.startsWith("/")) {
      try {
        const base = new URL(baseUrl);
        imgUrl = `${base.protocol}//${base.host}${imgUrl}`;
      } catch {
        continue;
      }
    }

    if (imgUrl.startsWith("http")) {
      urls.push(imgUrl);
    }
  }

  return urls.slice(0, 5); // Limit to 5 images
}

/**
 * Extract links from HTML.
 */
function extractLinksFromHtml(html: string): string[] {
  const urls: string[] = [];
  const linkRegex = /<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    urls.push(match[1]);
  }

  return urls.slice(0, 20); // Limit to 20 links
}

/**
 * Extract a readable title from URL path.
 */
function extractTitleFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    const slug = path.split("/").filter(Boolean).pop() || "";
    // Convert slug to title case
    return slug
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .substring(0, 100);
  } catch {
    return "Untitled";
  }
}
