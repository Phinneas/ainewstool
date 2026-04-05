/**
 * check-feeds.ts — Feed health check utility (TASK-13)
 *
 * Tests each enabled feed in feeds.json and reports HTTP status, item count,
 * and most recent item date. Flags feeds as STALE when:
 *   - HTTP status is not 200, OR
 *   - item count is 0, OR
 *   - most recent item is older than 14 days
 *
 * Usage: npx ts-node check-feeds.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

interface FeedDefinition {
  name: string;
  sourceName: string;
  feedUrl: string;
  httpUrl?: string;
  format: "rss" | "json" | "scraped_page";
  category: string;
  enabled: boolean;
  disabledReason?: string;
}

interface FeedsConfig {
  feeds: FeedDefinition[];
}

interface FeedReport {
  name: string;
  feedUrl: string;
  format: string;
  status: number | string;
  itemCount: number | string;
  mostRecentDate: string;
  health: "OK" | "STALE" | "ERROR" | "SKIPPED";
  note: string;
}

const STALE_DAYS = 14;

function daysSince(isoDate: string): number {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return Infinity;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// JSON Feed checker (rss.app JSON format — items have date_published)
// ---------------------------------------------------------------------------
async function checkJsonFeed(url: string): Promise<Pick<FeedReport, "status" | "itemCount" | "mostRecentDate" | "health" | "note">> {
  const res = await fetch(url, {
    headers: { "User-Agent": "AI-Newsletter-FeedChecker/1.0" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    return { status: res.status, itemCount: 0, mostRecentDate: "N/A", health: "ERROR", note: `HTTP ${res.status}` };
  }

  const body = (await res.json()) as {
    items?: Array<{ date_published?: string; pubDate?: string; published?: string }>;
  };
  const items = body.items ?? [];

  if (items.length === 0) {
    return { status: res.status, itemCount: 0, mostRecentDate: "N/A", health: "STALE", note: "0 items" };
  }

  const dates = items
    .map((i) => i.date_published ?? i.pubDate ?? i.published)
    .filter((d): d is string => typeof d === "string")
    .map((d) => new Date(d).getTime())
    .filter((t) => !isNaN(t));

  if (dates.length === 0) {
    return { status: res.status, itemCount: items.length, mostRecentDate: "N/A", health: "STALE", note: "No parseable dates" };
  }

  const mostRecent = isoDate(new Date(Math.max(...dates)));
  const age = daysSince(mostRecent);
  const health = age > STALE_DAYS ? "STALE" : "OK";
  const note = health === "STALE" ? `Last item ${Math.floor(age)}d ago` : "";

  return { status: res.status, itemCount: items.length, mostRecentDate: mostRecent, health, note };
}

// ---------------------------------------------------------------------------
// RSS Feed checker (parse XML manually — no dependencies)
// ---------------------------------------------------------------------------
async function checkRssFeed(url: string): Promise<Pick<FeedReport, "status" | "itemCount" | "mostRecentDate" | "health" | "note">> {
  const res = await fetch(url, {
    headers: { "User-Agent": "AI-Newsletter-FeedChecker/1.0" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    return { status: res.status, itemCount: 0, mostRecentDate: "N/A", health: "ERROR", note: `HTTP ${res.status}` };
  }

  const xml = await res.text();
  const itemCount = (xml.match(/<item[\s>]/gi) ?? []).length;

  if (itemCount === 0) {
    return { status: res.status, itemCount: 0, mostRecentDate: "N/A", health: "STALE", note: "0 items" };
  }

  const pubDates = [...xml.matchAll(/<pubDate>([^<]+)<\/pubDate>/gi)]
    .map((m) => new Date(m[1].trim()).getTime())
    .filter((t) => !isNaN(t));

  if (pubDates.length === 0) {
    return { status: res.status, itemCount, mostRecentDate: "N/A", health: "STALE", note: "No parseable dates" };
  }

  const mostRecent = isoDate(new Date(Math.max(...pubDates)));
  const age = daysSince(mostRecent);
  const health = age > STALE_DAYS ? "STALE" : "OK";
  const note = health === "STALE" ? `Last item ${Math.floor(age)}d ago` : "";

  return { status: res.status, itemCount, mostRecentDate: mostRecent, health, note };
}

// ---------------------------------------------------------------------------
// Check dispatcher
// ---------------------------------------------------------------------------
async function checkFeed(feed: FeedDefinition): Promise<FeedReport> {
  const url = feed.format === "json" ? (feed.httpUrl ?? feed.feedUrl) : feed.feedUrl;

  if (feed.format === "scraped_page") {
    return {
      name: feed.name,
      feedUrl: url,
      format: feed.format,
      status: "—",
      itemCount: "—",
      mostRecentDate: "—",
      health: "SKIPPED",
      note: "scraped_page feeds are not checkable here",
    };
  }

  try {
    const result =
      feed.format === "json" ? await checkJsonFeed(url) : await checkRssFeed(url);
    return { name: feed.name, feedUrl: url, format: feed.format, ...result };
  } catch (err) {
    return {
      name: feed.name,
      feedUrl: url,
      format: feed.format,
      status: "ERROR",
      itemCount: 0,
      mostRecentDate: "N/A",
      health: "ERROR",
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Table printer
// ---------------------------------------------------------------------------
function pad(s: string, len: number): string {
  const str = String(s);
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function printTable(reports: FeedReport[]): void {
  const COL = { name: 28, format: 11, status: 6, items: 6, date: 10, health: 7 };

  const header =
    pad("FEED NAME", COL.name) + " | " +
    pad("FORMAT", COL.format) + " | " +
    pad("STATUS", COL.status) + " | " +
    pad("ITEMS", COL.items) + " | " +
    pad("LAST DATE", COL.date) + " | " +
    pad("HEALTH", COL.health) + " | NOTE";

  const sep = "─".repeat(header.length);
  console.log("\n" + sep);
  console.log(header);
  console.log(sep);

  for (const r of reports) {
    const c =
      r.health === "OK" ? "\x1b[32m" :
      r.health === "STALE" ? "\x1b[33m" :
      r.health === "SKIPPED" ? "\x1b[90m" : "\x1b[31m";
    const reset = "\x1b[0m";

    const row =
      pad(r.name, COL.name) + " | " +
      pad(r.format, COL.format) + " | " +
      pad(String(r.status), COL.status) + " | " +
      pad(String(r.itemCount), COL.items) + " | " +
      pad(r.mostRecentDate, COL.date) + " | " +
      `${c}${pad(r.health, COL.health)}${reset}` + " | " +
      r.note;

    console.log(row);
  }

  console.log(sep + "\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const configPath = resolve(process.cwd(), "feeds.json");
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as FeedsConfig;

  const enabled = config.feeds.filter((f) => f.enabled);
  const disabled = config.feeds.filter((f) => !f.enabled);

  console.log(`\n=== Feed Health Check ===`);
  console.log(`Feeds: ${enabled.length} enabled, ${disabled.length} disabled\n`);

  const reports: FeedReport[] = [];

  for (const feed of enabled) {
    process.stdout.write(`  Checking ${feed.name}...`);
    const report = await checkFeed(feed);
    const indicator =
      report.health === "OK" ? "\x1b[32mOK\x1b[0m" :
      report.health === "STALE" ? "\x1b[33mSTALE\x1b[0m" :
      report.health === "SKIPPED" ? "\x1b[90mSKIPPED\x1b[0m" : "\x1b[31mERROR\x1b[0m";
    process.stdout.write(` ${indicator}\n`);
    reports.push(report);
  }

  printTable(reports);

  const ok = reports.filter((r) => r.health === "OK").length;
  const stale = reports.filter((r) => r.health === "STALE").length;
  const errors = reports.filter((r) => r.health === "ERROR").length;
  const skipped = reports.filter((r) => r.health === "SKIPPED").length;

  console.log(
    `Summary:  \x1b[32m${ok} OK\x1b[0m` +
    `  \x1b[33m${stale} STALE\x1b[0m` +
    `  \x1b[31m${errors} ERROR\x1b[0m` +
    `  \x1b[90m${skipped} SKIPPED\x1b[0m\n`
  );

  if (stale > 0 || errors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
