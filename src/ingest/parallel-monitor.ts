/**
 * Parallel Monitor integration — Option B (polling).
 *
 * Two monitors are pre-configured via `setup-monitors.ts` and their IDs stored
 * in env vars. The daily cron polls both monitors for events since the last run
 * before doing any fresh search-based discovery.
 *
 * Monitor 1: "AI research breakthroughs" (contentType: research)
 * Monitor 2: "indie AI tool launches"    (contentType: project)
 */

import { config } from "../config.js";
import { log } from "../logger.js";
import type { NormalizedItem, ContentType } from "./types.js";

const PARALLEL_MONITOR_BASE = "https://api.parallel.ai/v1alpha/monitors";

interface MonitorEvent {
  type: string;
  event_group_id: string;
  output: string;
  event_date: string;
  source_urls: string[];
}

interface MonitorEventsResponse {
  events: MonitorEvent[];
}

/**
 * Poll a single Parallel Monitor for events since `sinceHours` hours ago.
 * Returns normalized items ready for the evaluation pipeline.
 */
async function pollMonitor(
  monitorId: string,
  sinceHours: number,
  contentType: ContentType,
  sourceName: string
): Promise<NormalizedItem[]> {
  if (!monitorId) return [];

  try {
    const response = await fetch(`${PARALLEL_MONITOR_BASE}/${monitorId}/events`, {
      headers: {
        "x-api-key": config.parallel.apiKey,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      log.warn("Parallel Monitor poll failed", {
        monitorId,
        status: response.status,
      });
      return [];
    }

    const data = (await response.json()) as MonitorEventsResponse;
    const events = data.events ?? [];

    // Filter to events within the requested window
    const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
    const recent = events.filter((e) => {
      const ts = new Date(e.event_date).getTime();
      return !isNaN(ts) && ts > cutoff;
    });

    log.info(`Parallel Monitor [${sourceName}]: ${recent.length}/${events.length} events in window`, {
      monitorId,
      sinceHours,
    });

    return recent.map((e) => ({
      title: extractTitle(e.output),
      url: e.source_urls[0] ?? "",
      summary: e.output,
      source: sourceName,
      publishedDate: e.event_date,
      contentType,
    } satisfies NormalizedItem));
  } catch (error) {
    log.error("Parallel Monitor poll error", {
      monitorId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Extract a short title from monitor event output text.
 * Monitor output is a prose description — use the first sentence as title.
 */
function extractTitle(output: string): string {
  const sentence = output.split(/[.!?\n]/)[0].trim();
  return sentence.length > 120 ? sentence.slice(0, 117) + "..." : sentence;
}

/**
 * Fetch events from all configured Parallel Monitors.
 * Called at the start of each cron run before search-based discovery.
 *
 * @param sinceHours How far back to look (default 25h to overlap cron windows safely)
 */
export async function fetchMonitorEvents(sinceHours = 25): Promise<NormalizedItem[]> {
  if (!config.parallel?.apiKey) {
    log.info("Parallel API key not set — skipping monitor poll");
    return [];
  }

  const researchId = config.parallel.monitorResearchId;
  const startupId = config.parallel.monitorStartupId;

  if (!researchId && !startupId) {
    log.info("No Parallel Monitor IDs configured — run setup-monitors.ts to create them");
    return [];
  }

  const [researchEvents, startupEvents] = await Promise.all([
    researchId
      ? pollMonitor(researchId, sinceHours, "research", "parallel-monitor-research")
      : Promise.resolve([]),
    startupId
      ? pollMonitor(startupId, sinceHours, "project", "parallel-monitor-startup")
      : Promise.resolve([]),
  ]);

  const total = researchEvents.length + startupEvents.length;
  log.info(`Parallel Monitor: ${total} total events fetched`, {
    research: researchEvents.length,
    startup: startupEvents.length,
  });

  return [...researchEvents, ...startupEvents];
}
