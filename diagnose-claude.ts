/**
 * Diagnose why stage-5 story selection stopped parsing after the Sonnet 5.5
 * upgrade. Uses the raw SDK (not chatWithClaude) so nothing is filtered or
 * thrown away before we can look at it.
 *
 *   npx tsx diagnose-claude.ts
 *
 * Needs ANTHROPIC_API_KEY in .env or the shell. Costs a few cents.
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { SELECT_STORIES_SYSTEM } from "./src/prompts/select-stories.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_TOKENS = 8192;

// Two synthetic stories — enough to exercise the real schema without a big prompt.
const PROMPT = `Previous newsletter content (to avoid repeats):
(none)

Available content items:
<identifier>item_0</identifier>
<title>New open-weight model tops reasoning benchmarks</title>
<type>news</type>
<source-name>Example Blog</source-name>
<external-source-urls>https://example.com/a</external-source-urls>
<content>Researchers released an open-weight model that leads several public reasoning benchmarks while remaining small enough to self-host. Weights and an evaluation harness are public.</content>

<identifier>item_1</identifier>
<title>Vector database adds on-disk indexing</title>
<type>news</type>
<source-name>Example Devlog</source-name>
<external-source-urls>https://example.com/b</external-source-urls>
<content>A vector database shipped on-disk indexing that cuts memory use for large collections, with a migration guide and benchmarks against the previous in-memory-only design.</content>

Select the top stories and respond with the required JSON.`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

async function probe(label: string, effort?: "low" | "medium" | "high") {
  console.log(`\n${"=".repeat(70)}\n${label}  (model=${MODEL}, effort=${effort ?? "unset"})\n${"=".repeat(70)}`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env and retry.");
    process.exit(1);
  }

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SELECT_STORIES_SYSTEM,
      messages: [{ role: "user", content: PROMPT }],
      ...(effort ? { output_config: { effort } } : {}),
    });
  } catch (err) {
    // A 400 here means output_config/effort is not accepted for this model or
    // account — which would itself be the root cause.
    console.log("REQUEST FAILED:", err instanceof Error ? err.message : String(err));
    return;
  }

  const types = response.content.map((b) => b.type);
  const textBlocks = response.content.filter((b) => b.type === "text");
  const firstText = textBlocks.length ? (textBlocks[0] as Anthropic.TextBlock).text : "";
  const allText = textBlocks.map((b) => (b as Anthropic.TextBlock).text).join("\n");

  console.log("stop_reason:      ", response.stop_reason);
  console.log("content blocks:   ", types.join(", ") || "(none)");
  console.log("text block count: ", textBlocks.length);
  console.log("usage:            ", JSON.stringify(response.usage));
  console.log("first text len:   ", firstText.length);
  console.log("joined text len:  ", allText.length);

  for (const [name, candidate] of [["FIRST block only", firstText], ["ALL blocks joined", allText]] as const) {
    const m = candidate.match(/\{[\s\S]*\}/);
    let parsed = "n/a";
    if (m) {
      try {
        const o = JSON.parse(m[0]);
        parsed = `OK — ${o.top_selected_stories?.length ?? "?"} stories`;
      } catch (e) {
        parsed = `JSON.parse FAILED: ${e instanceof Error ? e.message : e}`;
      }
    } else {
      parsed = "NO JSON MATCH (this is what breaks select-stories.ts:68)";
    }
    console.log(`  ${name.padEnd(19)} -> ${parsed}`);
  }

  console.log("\n--- first 400 chars of joined text ---");
  console.log(allText.slice(0, 400) || "(EMPTY — this is the silent '' bug)");
}

(async () => {
  // medium is what select-stories.ts actually uses.
  await probe("PRODUCTION CONFIG", "medium");
  // Compare against no effort, i.e. adaptive-thinking default.
  await probe("NO EFFORT SET", undefined);
})();
