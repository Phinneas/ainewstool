/**
 * setup-monitors.ts — One-time Parallel Monitor creation script.
 *
 * Run once to create the two monitors, then copy the printed IDs into:
 *   - .env  →  PARALLEL_MONITOR_RESEARCH_ID and PARALLEL_MONITOR_STARTUP_ID
 *   - Cloudflare  →  wrangler secret put PARALLEL_MONITOR_RESEARCH_ID
 *
 * Usage:
 *   npx ts-node setup-monitors.ts
 */

import { config } from "dotenv";
config();

const PARALLEL_API_KEY = process.env.PARALLEL_API_KEY;
const MONITORS_URL = "https://api.parallel.ai/v1alpha/monitors";

if (!PARALLEL_API_KEY) {
  console.error("❌  PARALLEL_API_KEY not set in .env");
  process.exit(1);
}

interface MonitorCreateResponse {
  monitor_id: string;
  query: string;
  status: string;
  frequency: string;
}

async function createMonitor(
  query: string,
  label: string
): Promise<string | null> {
  try {
    const response = await fetch(MONITORS_URL, {
      method: "POST",
      headers: {
        "x-api-key": PARALLEL_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        frequency: "1d", // check once per day, matching cron schedule
        metadata: { label },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`❌  Failed to create monitor [${label}]: ${response.status} — ${err}`);
      return null;
    }

    const data = (await response.json()) as MonitorCreateResponse;
    return data.monitor_id;
  } catch (error) {
    console.error(
      `❌  Error creating monitor [${label}]:`,
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

async function main(): Promise<void> {
  console.log("\n=== Parallel Monitor Setup ===\n");

  console.log("Creating research monitor...");
  const researchId = await createMonitor(
    "AI research breakthroughs and new papers in machine learning, LLMs, and AI systems",
    "ainewsletter-research"
  );

  console.log("Creating startup/indie monitor...");
  const startupId = await createMonitor(
    "indie AI tool launches and small team AI project releases — not from OpenAI, Google, Meta, Microsoft, Amazon, or Apple",
    "ainewsletter-startup"
  );

  console.log("\n=== Results ===\n");

  if (researchId) {
    console.log(`✅  Research monitor created: ${researchId}`);
  } else {
    console.log("❌  Research monitor failed");
  }

  if (startupId) {
    console.log(`✅  Startup monitor created:  ${startupId}`);
  } else {
    console.log("❌  Startup monitor failed");
  }

  if (researchId || startupId) {
    console.log("\n--- Add these to your .env ---");
    if (researchId) console.log(`PARALLEL_MONITOR_RESEARCH_ID=${researchId}`);
    if (startupId) console.log(`PARALLEL_MONITOR_STARTUP_ID=${startupId}`);

    console.log("\n--- Then push to Cloudflare ---");
    if (researchId)
      console.log(`wrangler secret put PARALLEL_MONITOR_RESEARCH_ID\n  → paste: ${researchId}`);
    if (startupId)
      console.log(`wrangler secret put PARALLEL_MONITOR_STARTUP_ID\n  → paste: ${startupId}`);
  }

  console.log("");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
