# Spec: move the stage-3 relevance judgement from Mistral to Jev via OpenRouter

**Status:** Phases 0–2 and 4 **implemented** (2026-09-30); Phase 3 (shadow run + calibration) and
the follow-up remain. `EVAL_PROVIDER` defaults to `mistral`, so production behaviour is unchanged
until the var is flipped.
**Worker:** `ainewsletter-ingest`
**Scope:** stage 3 only — `evaluateContentRelevance`. Stage 5 (`select-stories`) is out of scope.
**Files:** `src/llm/jev.ts` (new), `src/ingest/evaluate.ts`, `src/worker/handlers/evaluate.ts`,
`src/llm/api-keys.ts`, `src/config.ts`, `src/worker/index.ts`, `tests/evaluate.test.ts`,
`.env.example`, `wrangler.toml`

---

## Context

Stage 3 of the pipeline (ingest → scrape → **evaluate** → upload → generate → publish) decides
whether each scraped article belongs in the newsletter. It runs on **every** item from all 70
feeds, twice a week, which makes it the highest-volume LLM call in the system.

Today it calls Mistral Small and parses JSON out of a chat completion. That is the expensive and
fragile shape for this job: we pay for output tokens to produce a boolean and an integer, and we
run a regex/`JSON.parse` recovery path (`parseJson`, `evaluate.ts:53-61`) because a chat model can
always return something unparseable.

**Jev is not a chat model.** It is TypeSafe's "System One" decision model, routed through
OpenRouter. You send it application state plus typed questions; it returns a typed answer with
calibrated probabilities in a single forward pass. **Output tokens are free.** There is no prose,
no chain-of-thought, and nothing to parse.

That makes stage 3 an unusually clean fit — and it also means this is **not a model swap**. The
call shape changes, the return contract changes, and one field we currently produce cannot be
produced at all.

## What Jev actually is (verified against OpenRouter, 2026-09-29)

| Property | Value |
|---|---|
| Model ID | `typesafe/jev-1.13` (alias `~typesafe/jev-latest`) |
| Endpoint | `POST https://openrouter.ai/api/alpha/decisions` |
| Alt endpoint | `POST https://openrouter.ai/api/v1/systemone` (TypeSafe SDK compatibility only) |
| Auth | `Authorization: Bearer $OPENROUTER_API_KEY` — no separate TypeSafe account |
| Context | **32,000 tokens** |
| Input price | **$0.042 / 1M tokens** (`0.000000042` per token) |
| Output price | **$0** |
| Modality | `text -> decisions` |
| Providers | TypeSafe only — single provider, no fallback routing |
| `supported_parameters` | `[]` — no `temperature`, no `response_format`, no `max_tokens` |
| Uptime (30m / 5m / 1d) | 100% / 100% / 100% |

Three question primitives:

| Primitive | Answers | Returns |
|---|---|---|
| `noul` | Does this condition hold? | `{ type, noul }` — probability of yes, 0–1 |
| `score` | Where on an ordered scale? | `{ type, score, confidence, probabilities, legend }` |
| `choice` | Which one of these? | `{ type, choice, confidence, probabilities }` |

Request/response contract:

```jsonc
// POST /api/alpha/decisions
{
  "model": "typesafe/jev-1.13",
  "state": { "content": "...", "source": "blog_mistral" },  // string | object | array
  "questions": {
    "is_relevant": {
      "type": "noul",
      "instructions": "Is this content relevant to an AI/tech newsletter?",
      "criteria": { "true": "...", "false": "..." }
    },
    "rejection_tag": {
      "type": "choice",
      "instructions": "If rejected, which single reason best applies?",
      "criteria": { "job_posting": "...", "off_topic": "...", "marketing_only": "..." }
    }
  }
}
```

```jsonc
{
  "id": "gen-dec-1789738314-X5e5eKGQdvR9rblyX250",
  "model": "typesafe/jev-1.13-20260917",   // dated snapshot that served the request
  "provider": "TypeSafe",
  "answers": {
    "is_relevant":   { "type": "noul", "noul": 0.96 },
    "rejection_tag": { "type": "choice", "choice": "off_topic", "confidence": 0.75,
                       "probabilities": { "off_topic": 0.84, "job_posting": 0.16 } }
  },
  "usage": { "input_tokens": 476, "output_tokens": 70, "cost": 0.000019992 }
}
```

All questions in one request are answered **in parallel and cannot see each other's answers**.
`usage.cost` is USD for that call — use it for real budget tracking rather than estimating.

Errors to handle: `400` invalid params, `401` auth, **`413` payload too large**, **`429` rate
limit**, `500` internal, `502` provider error.

## Current behaviour (verified in code)

`evaluateContentRelevance(content, contentType)` (`src/ingest/evaluate.ts:43`) branches on
`detectContentType(item)` — a pure URL heuristic (`evaluate.ts:19-38`), no LLM involved:

| Branch | Call | Prompt asks for | Parsed into |
|---|---|---|---|
| `news` / `project` | `evaluateNewsContent` (`:79`) — `chatWithMistral({ maxTokens: 2048 })` | `chainOfThought`, `is_relevant_content` | `isRelevant`, `reasoning` |
| `research` | `evaluateResearchContent` (`:63`) — `chatWithMistral({ maxTokens: 512, model: "mistral-small-latest" })` | `score` 1–10, `headline`, `tldr` | `score`, `isRelevant: score >= 4`, `reasoning: tldr ?? headline` |

The research rubric (`src/prompts/evaluate-research.ts`) is a **weighted** score:
Accessibility 40%, Novelty 35%, Relevance 25%, accept at `>= 4`.

**Three callers** — all must keep working:

1. `src/worker/handlers/evaluate.ts:96` — the production Worker path (stage 3)
2. `src/ingest/index.ts:241` — local CLI ingest
3. `src/ingest/discover.ts:191` — discovery; feeds `ScoredCandidate` into
   `ensureResearchRepresentation` (`evaluate.ts:109-142`), which sorts on `evaluation.score`

What the handler does with the result (`src/worker/handlers/evaluate.ts`):

- `:101-103` — `relevanceScore`: research = `round(score/10, 2)`, news = `1.0` / `0.0`
- `:110` — rejected items cached in KV as `{ item, isRelevant: false, reasoning }`, TTL 24h
- `:117`, `:144` — **`evalModel: 'mistral'` hardcoded** → SurrealDB `eval_model`
- `:118` — `rejectionReason: evaluation.reasoning.slice(0, 500)` → SurrealDB `rejection_reason`
- `:134` — `relevanceReason: evaluation.reasoning` → `UploadMessage` (`src/worker/types.ts:38`)

### The reasoning text is observability-only

This is the key finding that makes the swap safe. `relevanceReason` is declared on
`UploadMessage` but **never read downstream**:

- `handleUploadQueue` builds R2 `customMetadata` from `key`, `type`, `title`, `authors`,
  `source-name`, `external-source-urls`, `image-urls`, `url`, `timestamp`, `feed-url`
  (`upload.ts:44-56`) — no relevance field.
- `src/worker/handlers/generate.ts` contains no reference to `relevanceReason`.
- Stage 5 reads article content back from R2, not from the evaluate result.

So the only live consumers of generated prose are SurrealDB's `rejection_reason` column and a
debug log line (`evaluate.ts:106`). **No newsletter content depends on it.**

## Target behaviour

Stage 3 calls Jev instead of Mistral. `EvaluationResult` keeps its existing shape so the three
callers, `ensureResearchRepresentation`, and the `relevanceScore` normalization are untouched:

```ts
export interface EvaluationResult {
  isRelevant: boolean;
  reasoning: string;   // retained as a field, but now a compact machine-readable summary
  score?: number;      // retained; still 1–10 for research, so score/10 normalization holds
  // new, optional:
  probability?: number;   // the noul value behind isRelevant, 0–1
  confidence?: number;    // ONLY from choice/score answers — see the correction below
  rejectionTag?: string;  // structured replacement for rejection prose
}
```

**Correction to an earlier assumption:** `noul` answers do **not** carry a `confidence` field.
Per the TypeSafe docs, `confidence` is returned on **Choice and Score answers only** — it is
computed from how concentrated the probability distribution is across the options or levels, and
a single yes/no probability has no distribution to summarise. The `noul` number *is* the signal.
So `confidence` will be populated from the `rejection_tag` choice and the research scores, and
left `undefined` on the news branch. Any threshold logic must not assume it exists.

`reasoning` becomes e.g. `"noul=0.87"` or `"tag=job_posting noul=0.04 conf=0.91"`. That keeps
SurrealDB's `rejection_reason` populated and queryable without a second LLM call.

### Decision: drop the prose, wire the number in

The question was whether `relevanceReason` should be dropped or wired in further. **Both, split by
what it carries.** The prose goes; the measurement gets promoted.

Drop the prose because it was never load-bearing — `relevanceReason` is written to the KV cache
and onto `UploadMessage` (`src/worker/types.ts:38`) and then read by nothing. Keeping a dead
string field alive just to hold `"noul=0.87"` is not a reason to keep it.

Wire the number in because Jev produces something the old Mistral path never could: a **calibrated
relevance probability for every article**, not a boolean. Today that signal is thrown away at the
stage-3 boundary — `relevanceScore` is computed at `handlers/evaluate.ts:101-103`, written to
SurrealDB, and then stage 5 re-derives relevance from scratch by reading article text. Concretely:

1. **Persist it to R2.** Add `'relevance-score': String(relevanceScore)` to the `customMetadata`
   block in `upload.ts:44-56`. It already carries `title`, `url`, `source-name`, etc.
2. **Surface it to stage 5.** `loadContentFromR2` / `loadContentForDate` (called at
   `generate/index.ts:165-167`) build the `entries` array passed to `selectTopStories`
   (`generate/index.ts:182`). Add the score to that entry shape and to the
   `<identifier>` block that `select-stories.ts:23-31` renders into the prompt.
3. **Let Sonnet rank, not re-judge.** Stage 5 then sees "this article scored 0.93 on relevance"
   alongside the text, so it spends its budget on editorial judgement — angle, balance, dedupe —
   instead of repeating a relevance pass a cheaper model already made.

This is the single biggest quality win available from the Jev move, and it costs one metadata key.
It is **optional and separable**: steps 1–3 can ship after the provider swap is stable. Flag it as
a follow-up if you want the cutover itself to stay minimal.

Note this makes `relevanceScore` a real product input rather than an analytics side-channel, so
the threshold choice in Blocker #3 stops being a purely internal tuning matter — a bad threshold
will now visibly bias what Sonnet picks.


### Question design

**News / project — one `noul`, one `choice`:**

The existing `EVALUATE_NEWS_PROMPT` (`src/prompts/evaluate-news.ts`) already splits cleanly into
Noul criteria — its "What IS relevant" list becomes `criteria.true`, its "What is NOT relevant"
list becomes `criteria.false`. Target shape:

```ts
const NEWS_QUESTIONS = {
  is_relevant: {
    type: "noul",
    instructions: "Is this content worth including in a newsletter for AI/tech practitioners?",
    criteria: {
      true: "AI/ML news, announcements, product launches, industry developments. "
          + "Tutorials, guides, how-to content on AI tools and techniques. "
          + "Research papers, summaries, technical deep-dives. "
          + "AI policy, regulation, societal-impact analysis. "
          + "AI-adjacent infrastructure: GPU/chip developments, cloud for AI, developer tools.",
      false: "Pure job postings or hiring announcements. "
           + "Content unrelated to AI/tech/software. "
           + "Marketing pages with no technical content or insight. "
           + "Extremely short content (less than a paragraph). "
           + "Spam or promotional content with no informational value.",
    },
  },
  rejection_tag: {
    type: "choice",
    instructions: "Which single reason best explains why this content would NOT belong?",
    criteria: {
      job_posting:    "A vacancy, hiring announcement, or careers page.",
      off_topic:      "Not about AI, tech, or software.",
      marketing_only: "Promotional page with no technical substance.",
      too_short:      "Less than a paragraph of real content.",
      spam:           "Spam, or promotional with no informational value.",
      belongs:        "None of these — the content does belong.",
    },
  },
} as const;
```

Note `rejection_tag` needs a `belongs` option. A `choice` **always picks one of the options you
list** — without an escape hatch it will assign a bogus rejection reason to every article that
passes, and the tag becomes meaningless. Both questions ride in one request, so the tag costs
nothing extra beyond its criteria text.

#### How the prompt changes shape

Four rules, all consequences of Jev having no text output:

1. **The article never goes in `instructions`.** It goes in `state`; the question refers to "this
   content". Repeating the text in the instruction doubles input spend for no benefit.
2. **Delete the JSON-format block.** `"You must respond with valid JSON in this exact format…"`
   and the `chainOfThought` / `is_relevant_content` schema exist only to constrain generated text.
   There is none. This also deletes `parseJson` (`evaluate.ts:53-61`) and its regex fallback.
3. **Prose bullets become criteria strings.** The IS/IS-NOT lists are already exactly the right
   content; they just move from the prompt body into `criteria.true` / `criteria.false`, where the
   model treats them as the decision boundary rather than as context to reason over.
4. **"Be reasonably inclusive — lean toward accepting it" must be deleted, and re-expressed as a
   number.** This is the important one. That sentence is a *threshold* written in prose, and it
   worked because a chat model could obey a bias instruction while committing to a boolean. Jev
   cannot: it returns a probability and never sees your preference. Leaving the sentence in does
   nothing; removing it without compensating silently makes the filter stricter. The bias moves to
   the cut point — see Blocker #3.

Also worth internalising before tuning anything: **a `noul` value near 0.5 means "genuinely
uncertain", not "moderately relevant."** The two feel interchangeable and are not. An item at 0.5
is one Jev could not read, which is a case for the `belongs`-tag confidence or a human/second-pass
route, not for a mid-tier accept.

**Research — three `score` questions, weighted in code:**

Jev's `score` takes a single ordered `criteria` array and returns a probability-weighted position
where **index 0 is the first criterion listed**. Do *not* collapse the rubric into one 10-level
scale — that discards the documented weighting. Instead ask three short ordered scales in the
same request (same `state`, so no extra input cost beyond the question text) and combine them:

```ts
const a = answers.accessibility.score;  // 0..4 scale -> normalize
const n = answers.novelty.score;        // 0..2
const r = answers.relevance.score;      // 0..3
const score = Math.round((0.40 * norm(a) + 0.35 * norm(n) + 0.25 * norm(r)) * 9 + 1);
```

Keeping the result on the existing **1–10** scale means `score >= 4`, `score / 10`, and
`ensureResearchRepresentation` all continue to work unchanged.

The `headline` and `tldr` fields are **dropped**. Per the finding above they only ever reached
`relevanceReason`, which nothing reads. If a research TL;DR is ever wanted in the newsletter, it
belongs in stage 5 where a generative model already runs.

### Do not force Jev into `LLMClient`

`src/llm/types.ts` defines `chat({ system, prompt, maxTokens, model }) => Promise<string>`.
Jev returns typed answers, not a string. Shoehorning it would mean serializing probabilities to
JSON and re-parsing them — reintroducing exactly the fragility this change removes.

Create `src/llm/jev.ts` with its own typed surface:

```ts
export async function decide<T extends Record<string, JevQuestion>>(params: {
  state: string | Record<string, unknown>;
  questions: T;
  model?: string;              // default 'typesafe/jev-1.13' — pinned, not :latest
  sessionId?: string;          // batchId, for OpenRouter observability grouping
}): Promise<{ answers: Record<keyof T, JevAnswer>; usage: JevUsage }>;
```

Use plain `fetch` — available in both the Worker and Node 18+. **No new dependency.** The
`@mistralai/mistralai` SDK stays; see "Mistral is not removed" below.

Pin `typesafe/jev-1.13`, not `~typesafe/jev-latest`. Thresholds tuned against one version must
not shift under a silent model bump.

## Blockers and constraints found in the code

### 1. 32K context vs. unbounded article content — the fix

**The problem.** `evaluateNewsContent` and `evaluateResearchContent` build the prompt as
`` `${PROMPT}\n${content}` `` with **no truncation**. `content` is the full Jina Reader markdown
(`src/ingest/scrape.ts:78,93` — `content: markdown`); scrape.ts bounds image URLs (5), links
(20/50) and a 100-char description, but never the body.

Mistral Small tolerates this (128K–262K context). **Jev caps at 32,000 tokens** and returns
`413 Payload Too Large` past its size limit. A long arXiv paper or a docs index page hard-fails —
and per the existing handler design (`handlers/evaluate.ts:154`) a failure just drops the item,
so this would look like mysteriously missing stories rather than an error.

**The fix — one choke point.** Bound the content once, in `evaluateContentRelevance` before it
branches, so all three callers inherit it and the two branch functions stay dumb:

```ts
const STATE_CHAR_BUDGET = 60_000;   // calibrate from shadow-mode usage.input_tokens

function boundForState(content: string): { text: string; truncated: boolean; originalChars: number } {
  if (content.length <= STATE_CHAR_BUDGET) {
    return { text: content, truncated: false, originalChars: content.length };
  }
  // Cut at the last paragraph boundary inside the budget, not mid-sentence.
  const window = content.slice(0, STATE_CHAR_BUDGET);
  const cut = window.lastIndexOf("\n\n");
  const text = cut > STATE_CHAR_BUDGET * 0.5 ? window.slice(0, cut) : window;
  return { text, truncated: true, originalChars: content.length };
}
```

Then `state` carries the bounded text plus the provenance, so the decision record says what was
actually judged:

```ts
state: {
  content: bounded.text,
  source_name: item.sourceName,
  content_type: contentType,
  truncated: bounded.truncated,
}
```

**Why head-only, and not head + tail.** The relevance signal sits in the headline and lede. A tail
slice sounds like free extra signal but in practice Jina's markdown ends in nav, "related posts",
footer links and newsletter-signup boilerplate — a tail window actively injects noise into the
judgement. For research items the same logic holds stronger: abstract and intro carry novelty,
accessibility and relevance; the references section carries nothing.

**Why 60,000 chars, and how to make it a measured number.** Jev's tokenizer is listed as `"Other"`
— the chars-per-token ratio is not published, so any figure is a guess until measured. 60,000 chars
is deliberately conservative: at 3–3.5 chars/token it is roughly 17–20K tokens, leaving 12K+ of
headroom for the question criteria (which are sent on *every* request), the state keys, and
tokenizer error. Most articles are 3–10K chars and never hit the cap at all.

Do not leave it a guess. **Every Jev response includes `usage.input_tokens`**, so shadow mode gives
the real ratio for free: log `originalChars` against `input_tokens` across a run, compute the
observed chars/token, and set the budget to ~85% of 32,000 tokens. That converts an arbitrary
constant into a calibrated one, and it is the same data that prices the whole change.

**Handle `413` as a distinct, recoverable error.** In `src/llm/jev.ts`, on `413` retry once at
half the content budget before giving up. A payload-size failure means the estimate was wrong, not
that the article is unjudgeable — silently dropping it is the worst of the three outcomes. Count
these in `PipelineMetrics` (`jev_413_retries`) so a rising count means the budget needs lowering.

**Interaction with the scraper.** This cap only bites when articles are huge, and how much signal
sits inside the budget depends on extraction quality. If Jina's markdown for a given source is
boilerplate-heavy, the first 60K chars buy less than they should. The separate scraper work
(main-content extraction, see the note at the end of this spec) raises signal density inside the
same token budget — the two changes compound.

### 2. No `temperature`, no `response_format`

`mistralClient` sets `temperature: 0.0` and `responseFormat: { type: "json_object" }`
(`src/llm/mistral.ts:26-27`). Jev's `supported_parameters` is empty — neither applies, and
neither is needed: the output is typed by construction. Note in the client that these are
deliberately absent, so nobody "fixes" it later.

Jev answers are still **not bit-identical run to run** (the docs show probabilities varying
slightly between calls). Thresholds must have margin.

### 3. The news threshold — how to set it

Today `is_relevant_content` is a boolean the model commits to, under a prompt instruction to "be
reasonably inclusive… lean toward accepting it". That instruction *was* the threshold. Jev never
sees it, so the cut becomes ours to choose and the default 0.5 is **stricter than what runs today**.

**Start at 0.35, and make it a var, not a constant.**

The 0.35 is not magic — it is "neutral 0.5, minus a lean", restoring in one number the bias the
prose sentence used to carry. Then tune it against shadow data. Put it beside `EVAL_PROVIDER`:

```toml
[vars]
EVAL_PROVIDER = "mistral"
RELEVANCE_THRESHOLD = "0.35"
```

so tuning between cron runs is a config change, not a deploy.

**Why bias toward recall.** The two error directions are not symmetric, and the code makes them
more asymmetric than they look:

| Error | Cost | Recoverable? |
|---|---|---|
| False accept | One slot in the 15-item array handed to stage 5 (`select-stories.ts:23`), which filters again | **Yes** — Sonnet is a second gate |
| False reject | Item cached as rejected in KV for 24h (`handlers/evaluate.ts:108-112`), never re-judged | **No** — gone from that issue |

A weak story that survives stage 3 gets caught by stage 5. A good story rejected at stage 3 is
unrecoverable. So stage 3 should optimise recall and let stage 5 own precision. That division
already exists implicitly; the threshold should encode it deliberately. (If the "wire the
probability into stage 5" follow-up ships, this is even more true — stage 5 will see the score and
can down-rank a marginal accept instead of being blind to it.)

**Use the `rejection_tag` as a tiebreaker in the uncertain band.** A `noul` near 0.5 means Jev
could not read the item, and the tag's `confidence` is the one place uncertainty is quantified:

```ts
function accept(noul: number, tag: { choice: string; confidence?: number }, threshold: number) {
  if (noul >= threshold + 0.15) return true;          // clear accept
  if (noul <= threshold - 0.15) return false;         // clear reject
  // Uncertain band: trust a confident rejection tag, otherwise lean accept.
  if (tag.choice !== "belongs" && (tag.confidence ?? 0) > 0.6) return false;
  return true;
}
```

This is the three-band pattern from the TypeSafe confidence guidance — act on high confidence,
proceed with caution in the middle, refuse to guess at the bottom — expressed with the only
confidence value a noul-plus-choice request actually gives you.

**How to pick the real number from shadow mode.** For every item log the Mistral boolean, the Jev
`noul`, the tag, and the tag confidence. Then:

1. Bucket the `noul` values and find where Mistral's accept rate crosses 50% — that is the
   like-for-like threshold, the one that reproduces today's behaviour.
2. Compare the total accept count at 0.35 vs that crossover point. If 0.35 accepts materially
   fewer items than Mistral did, the criteria text is stricter than the old prose and needs
   loosening — that is a *prompt* bug, not a threshold bug, and no threshold will fix it.
3. Hand-label ~50 items spanning the 0.3–0.7 band and pick the cut that maximises recall subject
   to not flooding stage 5. Fifty is enough; the band is narrow and the downstream gate is real.

Watch the accept count on the first live runs against the existing `relevant` / `rejected`
`PipelineMetrics` counters. A sudden drop in `relevant` is the failure mode to expect, and it is
visible on `/status` before it shows up as a thin newsletter.

### 4. Alpha endpoint, single provider

The Decisions API lives under `/api/alpha/`. TypeSafe is the only provider, so OpenRouter cannot
route around an outage. Mitigations: keep the Mistral path in the codebase behind a flag, and
treat `429`/`5xx`/network failure as retryable with backoff — `src/ingest/concurrency.ts`
already exports `Semaphore` and `mapConcurrent` for this.

### 5. `evalModel` is hardcoded

`evaluate.ts:117` and `:144` write `evalModel: 'mistral'` to SurrealDB. This must become the
actual provider string, or the analytics will silently mislabel every Jev decision. During
shadow mode it should distinguish `jev-shadow` from `jev`.

## Mistral is NOT removed

Only the evaluate path moves. Two other callers of `chatWithMistral` are **generative** and
cannot use Jev:

- `src/ingest/extract-sources.ts:53` — extracts external source URLs from content
- `src/ingest/generate-queries.ts:61` — writes search queries (`model: "mistral-small"`)

So `MISTRAL_API_KEY`, `src/llm/mistral.ts`, `apiKeys.mistral`, and `tests/extract-sources.test.ts`
all stay exactly as they are. **Do not delete them.** The README model table needs a row added,
not a row replaced.

## Configuration and secret wiring

Follow the existing lazy-key pattern exactly — `config.x.apiKey` is `''` at Worker cold start and
`apiKeys.x` is populated by the queue handler before any LLM call (see the comment at
`src/llm/mistral.ts:6-9`).

1. `.env.example` — add `OPENROUTER_API_KEY=` to the `# LLM Providers` block
2. `src/config.ts` — add an `openrouter: { apiKey: isWorker ? '' : (process.env.OPENROUTER_API_KEY || '') }`
   block next to `mistral` (`:30-32`)
3. `src/llm/api-keys.ts` — add `openrouter: string` to both the `declare global` shape **and** the
   `globalThis.__apiKeys` initializer
4. `src/worker/index.ts` — add `OPENROUTER_API_KEY?: string` to the `Env` Secrets block (`:32-48`)
5. ~~`src/worker/config.ts`~~ — **skip, this file is dead code.** `getWorkerEnv` has zero callers.
6. ~~`src/worker/lib/config.ts`~~ — **skip, this file is dead code.** `getConfig` has zero callers.
   Both were listed here on the assumption that they followed the live pattern; verified during
   implementation that nothing imports either. Do not port them. See "Dead config files" below.
7. `src/worker/handlers/evaluate.ts:43` — add `apiKeys.openrouter = env.OPENROUTER_API_KEY ?? ''`
   beside the existing `apiKeys.mistral` assignment
8. `src/worker/test-manual.ts:93` — add to the env object
9. `wrangler secret put OPENROUTER_API_KEY`
10. `wrangler.toml` — add plain vars. There is no `[vars]` block today; add one:

```toml
[vars]
EVAL_PROVIDER = "mistral"      # mistral | jev | shadow
RELEVANCE_THRESHOLD = "0.35"   # noul cut point — see Blocker #3
STATE_CHAR_BUDGET = "60000"    # content bound before it reaches Jev — see Blocker #1
```

Plain vars, not secrets, so the cutover *and* the two tuning constants are config changes —
neither rollback nor re-thresholding needs a code deploy. Stage 3 reads `EVAL_PROVIDER` and
dispatches; the `shadow` value calls both providers, **acts on Mistral**, and logs the Jev answer,
`usage.cost` and `usage.input_tokens` for comparison.

The CLI paths (`src/ingest/index.ts`, `discover.ts`) pick up `process.env.OPENROUTER_API_KEY`
through `src/config.ts` and need no handler change.

## Cost

Jev input is **$0.042/1M** and output is **free**. The comparable OpenRouter-listed Mistral Small
(`mistralai/mistral-small-2603`) is **$0.15/1M in, $0.60/1M out** — roughly 3.6× more on input
and a paid output on top.

Caveat: this repo calls Mistral's **first-party** API with `mistral-small-latest`, not OpenRouter,
so confirm the real baseline from the Mistral dashboard before quoting a saving. Also note the
current calls reserve `maxTokens: 2048` (news) / `512` (research) of output that Jev eliminates
entirely.

Two effects push the other way and should be measured, not assumed:

- The question `criteria` text is sent as input on **every** request, and it is longer than a
  one-line instruction. It is still far cheaper than 2,048 output tokens.
- Truncating content to fit 32K *reduces* input tokens versus today, which is a saving in itself.

Record `usage.cost` per call into the existing `PipelineMetrics` KV counters so the actual figure
is visible on `/status` rather than estimated.

## Rollout

1. **Land the client behind the flag, default `mistral`.** No behaviour change in production.
2. **Shadow mode** for 2–3 cron runs (`0 7 * * 1-5` ingest, `0 8 * * 3` / `0 8 * * 6` generate).
   Log per item: Mistral decision, Jev `noul`, Jev tag, agreement, `usage.cost`, input tokens,
   whether truncation fired.
3. **Pick thresholds** from the shadow data — the news `noul` cut and whether the research
   weighted score still lands accept at `>= 4`. Check the accept rate; a materially thinner pool
   means the threshold is too strict.
4. **Flip `EVAL_PROVIDER` to `jev`.** Watch the `relevant` / `rejected` / `evaluate_item_errors`
   metrics and the stage-5 shortlist quality for two issues.
5. **Keep the Mistral branch** until Jev has run clean for a few weeks. Then delete the evaluate
   path's Mistral usage — but not `src/llm/mistral.ts`.

## Work items

Ordered so each phase is independently shippable. Phase 0 is worth doing even if Jev never lands.

### Phase 0 — unblock (no provider change)

1. Add `boundForState()` at the top of `evaluateContentRelevance` — one choke point, so all three
   callers inherit it. Paragraph-boundary cut, `STATE_CHAR_BUDGET`, log when it fires.
   **This is safe on Mistral and cuts its input cost immediately**, so it can ship alone and be
   verified before anything else moves.

### Phase 1 — client and flag, default off

2. `src/llm/jev.ts` — typed `decide()` over plain `fetch`, zod-validated response, retry with
   backoff on `429`/`5xx`. On `413`, halve the content budget and retry **once**, then surface it
   as a distinct error. Pin `typesafe/jev-1.13`.
3. Wire `OPENROUTER_API_KEY` through all eight config surfaces above + `wrangler secret put`.
4. Add the `[vars]` block: `EVAL_PROVIDER`, `RELEVANCE_THRESHOLD`, `STATE_CHAR_BUDGET`.
5. `EVAL_PROVIDER` dispatch (`mistral` | `jev` | `shadow`) in the stage-3 handler. Shadow **acts on
   Mistral** and logs the Jev answer, `usage.cost` and `usage.input_tokens`.
6. Replace hardcoded `evalModel: 'mistral'` at `handlers/evaluate.ts:117,144` with the live
   provider string — `jev-shadow` while shadowing, so the analytics never mislabel.

### Phase 2 — the Jev questions

7. `evaluateNewsContent` → one `noul` + one `choice` per `NEWS_QUESTIONS`; implement the
   three-band `accept()` from Blocker #3. Remember `confidence` is **undefined** on the noul answer.
8. `evaluateResearchContent` → three `score` questions, combined 40/35/25 onto the existing 1–10
   scale. Drop `headline` / `tldr`.
9. Delete `parseJson` (`evaluate.ts:53-61`) and the "respond with valid JSON" blocks. Retire
   `EVALUATE_NEWS_PROMPT` / `EVALUATE_RESEARCH_PROMPT` as chat strings — their criteria move into
   the question definitions. Keep the accept-threshold comment.
10. Extend `EvaluationResult` with `probability` / `confidence` / `rejectionTag`. **Keep
    `reasoning` and `score`** so the three callers, `relevanceScore` normalization and
    `ensureResearchRepresentation` stay untouched.
11. Record `usage.cost` and `input_tokens` in `PipelineMetrics`; add a `jev_413_retries` counter.

### Phase 3 — shadow, calibrate, cut over

12. Run shadow for 2–3 cron cycles, then derive both constants from the data:
    `STATE_CHAR_BUDGET` from the observed chars/token ratio, `RELEVANCE_THRESHOLD` from the
    Mistral-agreement crossover. Hand-label ~50 items in the 0.3–0.7 band.
13. Flip `EVAL_PROVIDER` to `jev`. Watch `relevant` / `rejected` / `evaluate_item_errors` and the
    stage-5 shortlist size across two full issues.

### Phase 4 — tests and docs

14. Rewrite `tests/evaluate.test.ts` — it mocks `../src/llm/mistral.js` and asserts
    `result.reasoning` contains `"AI model"` (`:46-48`), which breaks. Mock `src/llm/jev.js`
    instead. Cases: noul above / below / inside the uncertain band, tag-driven rejection,
    weighted research score mapping, truncation firing, `413`-then-retry, `429`-then-retry,
    malformed answers. Leave `tests/extract-sources.test.ts` alone — that path stays on Mistral.
15. Update `README.md` — pipeline diagram (`:28-30`), model table (`:56`), env var table (`:88`),
    file tree (`:196,206`). Add an OpenRouter row; do **not** remove the Mistral one.

### Follow-up — separable, ship after the cutover is stable

16. Wire the relevance probability through to stage 5: `'relevance-score'` into R2
    `customMetadata` (`upload.ts:44-56`) → the `entries` built at `generate/index.ts:165-167` →
    the `<identifier>` block at `select-stories.ts:23-31`. This is the change that turns a
    discarded measurement into an editorial signal, and it should not be coupled to the provider
    swap — land it once `jev` is boring.

## Verification

- `npm test` (vitest) green, including the new Jev cases.
- `npm run build` (`tsc`) clean — the config surface spans five files and will not type-check by luck.
- Shadow run over one real ingest: agreement rate logged for every item, `usage.cost` total
  matches the OpenRouter dashboard.
- Feed a deliberately oversized article (an arXiv paper or a docs index): it is truncated and
  judged, **not** a `413`.
- `EVAL_PROVIDER=jev` run: `eval_model` in SurrealDB reads `jev`, `rejection_reason` holds a tag,
  and `relevance_score` for research is still on 0–1 from `score/10`.
- `ensureResearchRepresentation` still force-inserts a research item when none pass — feed it a
  batch with zero passing research and confirm the swap-in happens.
- Stage 5 receives a non-empty shortlist of the usual size; generate → publish completes.
- Kill `OPENROUTER_API_KEY` mid-run: stage 3 degrades per item (existing `try/catch` at
  `handlers/evaluate.ts:154`) and the batch still acks — one provider outage must not stall the queue.

## Out of scope

- **Stage 5 `select-stories`.** It runs Claude Sonnet 4.5 (`src/llm/anthropic.ts:18`) and
  generates story summaries and chain-of-thought that the newsletter body is built from. Jev
  cannot produce prose, so it cannot replace this step. A future change could use Jev as a cheap
  pre-scorer feeding Sonnet a smaller candidate set — that is a separate spec.
- `extract-sources.ts` and `generate-queries.ts` — generative, stay on Mistral.
- Migrating the whole repo to OpenRouter. Anthropic, Moonshot/Kimi, Ideogram and Mistral keep
  their first-party clients.
- The TypeSafe SDK (`@typesafe-ai/sdk`) and the `/api/v1/systemone` surface — plain `fetch`
  against the Decisions API avoids a dependency and works identically in Worker and Node.
- Signal Field, which shares this architecture and should follow once this is proven.

## Rollback

Set `EVAL_PROVIDER = "mistral"` in `wrangler.toml` and redeploy — no code revert, no secret
changes. KV evaluate caches written during a Jev run store `relevanceReason` as a compact
summary string rather than prose; since nothing downstream reads that field, stale mixed-vendor
cache entries are harmless and expire on their 24h / 7d TTLs.

---

## Note: the scraper interacts with this change

The 32K bound in Blocker #1 is only half the story — how much *signal* fits inside that bound
depends on stage 2. Current chain (`src/ingest/scrape.ts`): Jina Reader keyless (`:58`,
`markdown.length < 100` guard at `:80`) → Exa `/contents` (`:113`, **only if a key is passed**) →
native `fetch` + regex HTML→markdown (`:167`) → null.

Three problems found while researching this, all pre-existing and none caused by the Jev move:

1. **The Exa tier is unreachable from the CLI.** `src/ingest/index.ts:200` and
   `src/generate/index.ts:122` call `scrapeUrl(item.url)` with no second argument; only the Worker
   passes one (`handlers/scrape.ts:39` → `env.EXA_API_KEY`). So `npm run ingest` is Jina → regex.
2. **CLI scrape concurrency is 8** (`src/ingest/index.ts:192`) against Jina's keyless ceiling of
   **20 requests/min per IP**. 8 in flight attempts ~60/min, so `429`s are expected — and a 429
   hits `!response.ok` (`:73`) and returns null, presenting as "empty content" rather than a rate
   limit. This is a likelier cause of short/empty scrapes than extraction quality.
3. **The regex tier truncates nested markup.** `extractFromHtml`'s div patterns (`:242-247`) are
   non-greedy, so they stop at the *first* `</div>` rather than the matching one. Same class of bug
   at `:299` (`<p>`) and `:302` (`<a>` requires `([^<]+)`, dropping nested tags).

**Parallel Extract is the strongest candidate to consolidate on** — `POST
https://api.parallel.ai/v1/extract`, `$1 / 1,000 URLs`, **600 req/min**, up to **20 URLs per
request**, handles JS-heavy pages **and PDFs**, returns markdown via `results[].excerpts[]` and
`results[].full_content`. `PARALLEL_API_KEY` is already wired (`src/config.ts:47`) and the repo
already calls `api.parallel.ai` for Search (`src/ingest/search.ts:148-178`) and Monitors
(`parallel-monitor.ts:16`) — so it adds **no new vendor and no new credential**. At this pipeline's
volume the cost is roughly $9–16/month.

One trap worth naming: **do not cap content at scrape time.** `advanced_settings.full_content.max_chars_per_result`
looks like a free fix for Blocker #1, but `scrapeResult.content` feeds stage 4 (the `.md` written
to R2) and stage 5 reads it back to write the newsletter. Truncating at the scraper would
permanently shorten the stored article to suit the judge. Keep `boundForState()` local to stage 3,
and use Parallel's cap only as a sanity ceiling (e.g. 200,000) against pathological multi-MB pages.

Also avoid sending an `objective` on the evaluate path. Objective-focused excerpts are pre-filtered
for relevance, so Extract would thin out exactly the content Jev is being asked to judge —
circular. Use uncapped `full_content` for stage 3; `objective` + excerpts is a good fit for
`extract-sources.ts`, which wants links, not the body.

Separately: the repo calls **`/v1beta/search`** and **`/v1beta/findall/runs`**. Parallel's docs now
say to use `/v1/search` and `/v1/extract` for all new integrations and to treat `/v1beta` as
maintenance-only. Migrating the existing Search call is unrelated to this spec but worth doing
before it becomes forced.

Scraper work is **out of scope here** — it needs its own spec. It is called out because Blocker #1's
budget and the accept rate both move depending on how clean the incoming markdown is.

---

## Implementation notes (2026-09-30)

What actually shipped, and where it deviates from the plan above.

### Dead config files — do not port

`src/worker/config.ts` (`getWorkerEnv`) and `src/worker/lib/config.ts` (`getConfig`) have **zero
callers**. Both were listed as wiring surfaces on the assumption that they followed the live
pattern. Verified by grep that nothing imports either. The real wiring is only four surfaces:
`src/config.ts`, `src/llm/api-keys.ts`, the `Env` interface in `src/worker/index.ts`, and the
handler's `apiKeys.*` assignments. Candidates for deletion, along with `src/llm/kimi.ts`.

### Shipped

- **Phase 0** — `boundForState()` in `src/ingest/evaluate.ts`, one choke point in
  `evaluateContentRelevance`. Applied on the **Jev path only**; the Mistral path is byte-for-byte
  unchanged so shadow mode compares like-for-like against current production behaviour.
- **Phase 1** — `src/llm/jev.ts` (typed `decide()`, plain `fetch`, zod-validated, backoff on
  429/5xx honouring `Retry-After`, `JevPayloadTooLargeError` distinct from `JevError`);
  `OPENROUTER_API_KEY` through the four live surfaces; `[vars]` block with all three knobs;
  `EVAL_PROVIDER` dispatch including `shadow`.
- **Phase 2** — `NEWS_QUESTIONS` (noul + choice with a `belongs` escape), `RESEARCH_QUESTIONS`
  (three 5-level score axes), `combineResearchScore()`, `acceptNews()` three-band logic,
  `EvaluationResult` extended with `probability` / `confidence` / `rejectionTag` / `truncated` /
  `provider` / `usage`.
- **Phase 4** — `tests/evaluate.test.ts` rewritten: **6 tests → 40, all passing**. It also fixed a
  pre-existing failure (`expect(reasoning).toBe("Failed to parse")` against the actual string
  `"Failed to parse LLM response"`).

### Deviations and additions

1. **`rejection_tag` needed a `belongs` option** that the plan did not spell out. A `choice` always
   picks one of the listed options, so without an escape hatch every *accepted* article would get a
   bogus rejection tag and the column would be unqueryable.
2. **`relevanceScore` for Jev news items now uses the noul probability** instead of `1.0`/`0.0`
   (`handlers/evaluate.ts`). This is a partial, early landing of the "wire the number in"
   follow-up — the probability now reaches SurrealDB for news items too, not just research. The
   R2-metadata → stage-5 half of that follow-up is **still deferred**.
3. **`eval_model` in shadow mode is `mistral:shadow`**, not `jev-shadow`. The decision that acted
   came from Mistral; labelling it `jev-*` would misattribute it in analytics. The `jev_*` and
   `shadow_*` metric counters carry the Jev side.
4. **413 retry lives in `evaluateContentRelevance`, not in `jev.ts`.** Only the caller knows how to
   shrink `state`, so the client throws `JevPayloadTooLargeError` and the caller halves the budget
   once. Keeps `jev.ts` generic — which matters for the port.
5. **Settings resolve from `process.env` inside `readEvalSettings()`**, matching how the handler
   already copies `EXA_API_KEY`/`TAVILY_API_KEY`/`PARALLEL_API_KEY` onto `process.env`. That way
   all three callers (Worker, CLI ingest, discovery) behave identically without threading options
   through every call site. Explicit `options` always win.
6. **Cost is accumulated locally and written once per batch** as `jev_cost_micro_usd`, rather than
   a KV increment per item — `PipelineMetrics.increment` is a read-modify-write, so per-item calls
   would scale KV writes with batch size.

### Not done

- **Phase 3** — no shadow run yet. `RELEVANCE_THRESHOLD = 0.35` and `STATE_CHAR_BUDGET = 60000` are
  reasoned starting values, **not calibrated**. Do not flip `EVAL_PROVIDER` to `jev` before running
  shadow across 2–3 cron cycles and deriving both from the logs.
- **The stage-5 wiring follow-up** (item 16).
- `src/worker/test-manual.ts` env object (item 8) — not updated.
- README (item 15) — not updated.
- Requires `wrangler secret put OPENROUTER_API_KEY` before shadow or jev mode will work.


