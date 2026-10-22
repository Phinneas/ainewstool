# Spec: upgrade the generate stage from Claude Sonnet 4.5 to Sonnet 5.5

**Status:** **implemented** (2026-09-30), items 1–7. Item 8 (read a generated issue end to end) and
item 9 (watch the first production cron run) still need a human. No live API call has been made
against Sonnet 5.5 yet — verification so far is type-check and unit tests only.
**Worker:** `ainewsletter-ingest`
**Files:** `src/llm/anthropic.ts`, `src/generate/*.ts` (7 call sites), `src/worker/index.ts`,
`src/config.ts`, `src/llm/api-keys.ts`, `src/llm/types.ts`, `wrangler.toml`, `.env.example`

---

## Urgency

`src/llm/anthropic.ts:18` hardcodes `claude-sonnet-4-5-20250929`. Anthropic's published
deprecation table lists that model's retirement commitment as **"Not sooner than September 29,
2026"** — which is **today**.

It is still marked `Active`, so nothing has broken. But the commitment floor has expired: from
here Anthropic can announce a deprecation date at any time. The precedent in the same table is
`claude-3-7-sonnet-20250219` — deprecated October 28 2025, retired February 19 2026, roughly
four months' notice. A four-month fuse is comfortable; no fuse is not.

Every stage-5 and stage-6 generation call goes through this one line. If it retires, the pipeline
produces no newsletter.

## Why 5.5 and not 5.0

The question was "5.5 or at least 5.0". **Go straight to 5.5 — 5.0 is not a cheaper option.**

Verified from Anthropic's docs today:

| Model | API ID | Status | Released | $/MTok in / out | Context | Max out | Default effort | Retire not sooner than |
|---|---|---|---|---|---|---|---|---|
| Sonnet 4.5 (**current**) | `claude-sonnet-4-5-20250929` | Legacy | 2025-09-29 | **$3 / $15** | 200K | 64K | not supported | **2026-09-29** |
| Sonnet 5 | `claude-sonnet-5` | **Legacy** | 2026-06-30 | $2 / $10 | 1M | 128K | `high` | 2027-06-30 |
| Sonnet 5.5 | `claude-sonnet-5-5` | **Latest** | 2026-09-28 | $2 / $10 | 1M | 128K | `high` | 2027-09-28 |

Sonnet 5 and Sonnet 5.5 are **the same price**. Sonnet 5 is already flagged Legacy and its
retirement floor is three months earlier. There is no cost argument for 5.0 and a lifespan
argument against it.

**5.5 is a 33% price cut on both axes** versus what runs today ($3→$2 input, $15→$10 output),
with 5× the context window and 2× the max output. Cache economics improve too: 5m write
$3.75→$2.50/MTok, 1h write $6→$4, cache read $0.30→$0.20.

Also note: "Every Claude model ID is a pinned snapshot, including the dateless IDs used from the
4.6 generation on." So `claude-sonnet-5-5` is **not** a floating alias — it will not silently
change behaviour under you. Pin it directly.

## The catch: adaptive thinking is on by default

This is what makes the change more than a one-line edit.

Sonnet 4.5 supports no thinking parameter, and the current client sends none
(`src/llm/anthropic.ts:17-23`). Sonnet 5.5 has **adaptive thinking on by default at `high`
effort**. Per Anthropic's docs: *"Current-turn thinking always counts toward `max_tokens`, is
billed as output tokens, and occupies context window space for the turn that generated it."*

Two consequences:

**1. Cost can go up despite the unit price going down.** Thinking tokens are billed as output at
$10/MTok. At the default `high` effort on a prose-generation task, that is pure overhead.

**2. `max_tokens` can be consumed before the JSON is written.** All seven call sites pass through
one client, and three of them cap at 2048:

| Call site | `maxTokens` | Task |
|---|---|---|
| `src/generate/select-stories.ts:48-51` | 8192 | story selection, zod-validated JSON |
| `src/generate/write-section.ts:42-45` | 8192 | prose + `chainOfThought` JSON |
| `src/generate/subject-line.ts:30-33` | 4096 | subject line JSON |
| `src/generate/write-intro.ts:31-34` | 4096 | intro prose JSON |
| `src/generate/write-shortlist.ts:53-56` | **2048** | shortlist JSON |
| `src/generate/ai-discoveries.ts:120-124` | **2048** | JSON |
| `src/generate/ai-for-good.ts:126-130` | **2048** | JSON |

If thinking eats 1,500 of a 2,048 budget, the JSON is truncated mid-string. `select-stories.ts`
then fails zod validation and **throws** `"Story selection response did not match expected schema"`
(`:73`, re-thrown at `:80`) — a hard pipeline failure at stage 5, presenting as a schema error
rather than what it actually is.

**You cannot turn thinking off on Sonnet 5.5.** From Anthropic's thinking-mode compatibility table:

| `thinking` value | Sonnet 5.5 | Sonnet 5 |
|---|---|---|
| *(omitted)* | Adaptive thinking | Adaptive thinking |
| `{"type":"adaptive"}` | Adaptive thinking | Adaptive thinking |
| `{"type":"disabled"}` | **400 error** | Thinking off |
| `{"type":"between_tools"}` | Up-front thinking off, **at `high` effort or below** | 400 error |

So the levers on 5.5 are `output_config.effort` and `between_tools` — not `disabled`. (This is
the one genuine argument for Sonnet 5, which *does* accept `disabled`; it is outweighed by 5
already being Legacy.)

## Target behaviour

### 1. Model ID becomes configuration

Stop hardcoding. Add to `src/llm/anthropic.ts`:

```ts
const DEFAULT_MODEL = 'claude-sonnet-5-5';

function getModel(): string {
  return config.anthropic.model || apiKeys.anthropicModel || DEFAULT_MODEL;
}
```

and an `ANTHROPIC_MODEL` var in `wrangler.toml` `[vars]`, plus `.env.example`. The next model
generation should be a config change, not a code change and a redeploy — which is exactly the
position the repo is in today and why this is urgent rather than merely overdue.

### 2. Effort becomes a per-call parameter

`output_config.effort` is **already supported** by the installed SDK — `OutputConfig` is defined
at `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts:415-425` with
`effort?: 'low' | 'medium' | 'high' | 'max' | null`, and wired into the request at `:1059`. No
upgrade needed for this.

Extend `chatWithClaude`'s params with `effort?` and pass it through:

```ts
export async function chatWithClaude(params: {
  system?: string;
  prompt: string;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'max';
}): Promise<string>
```

Recommended settings, from Anthropic's own effort guidance (`low` = "efficient, best for short
scoped tasks"; `medium` = "the drop-in for the average workflow where you want good results while
reducing costs", comparable to Sonnet 4.6 at high effort):

| Call site | Effort | Why |
|---|---|---|
| `select-stories` | `medium` | Genuine judgement — ranking, dedupe, balance. Worth some thinking. |
| `write-section` | `medium` | Reader-facing prose with a `chainOfThought` field. |
| `write-intro` | `low` | Short, scoped, style-constrained. |
| `subject-line` | `low` | Short, scoped. |
| `write-shortlist` | `low` | Short, scoped. |
| `ai-discoveries` | `low` | Short, scoped. |
| `ai-for-good` | `low` | Short, scoped. |

**Do not leave effort unset.** Unset means `high`, which is the default that generates the most
thinking tokens on tasks that do not need them. Setting it explicitly is also the documented
guidance: *"Explicitly set effort when using [these models] to avoid unexpected latency."*

### 3. Raise the 2048 ceilings — this is free

`max_tokens` is a **ceiling, not a reservation**. You are billed for tokens actually generated, so
raising 2048 → 8192 on the three tight call sites costs nothing unless the model genuinely needs
the room. Given thinking now shares that budget, it should be raised regardless of effort level.
This is the cheapest insurance in the whole change.

### 4. Surface `stop_reason` — currently discarded

`anthropicClient.chat` does `response.content.find(b => b.type === 'text')` and returns the string
(`:24`), throwing away `stop_reason`. That is why a truncation would surface as a confusing
zod error two layers up. Check it:

```ts
if (response.stop_reason === 'max_tokens') {
  throw new Error(`Claude hit max_tokens (${maxTokens}) — output truncated, likely thinking overhead`);
}
```

A loud, accurate failure beats a schema-validation error that sends you debugging the prompt.

Note also that with adaptive thinking the response `content` array will contain `thinking` blocks
alongside text. `.find(b => b.type === 'text')` still picks the right one, so no change is needed
there — but it is worth knowing the array shape has changed.

### 5. Consider prompt caching

`write-section` is called **once per selected story** with the same large system prompt every
time; `select-stories`, `write-intro` and `subject-line` likewise repeat fixed system prompts run
to run. Cache reads on Sonnet 5.5 are **$0.20/MTok against $2/MTok** base input — a 10× cut on
the repeated prefix. Adding `cache_control` to the system block is a small, separable change with
a real payoff, and the 1M context window makes caching a larger prefix viable than on 4.5's 200K.

Treat it as a follow-up, not part of the upgrade.

## SDK version

Installed: **0.74.0**. Latest: **0.129.0**.

The upgrade is **not required** for this spec:
- `claude-sonnet-5-5` type-checks today — the `Model` union ends with `| (string & {})`
  (`messages.d.ts:414`), so arbitrary strings are accepted.
- `output_config.effort` with `low|medium|high|max` exists in 0.74.0.

The upgrade **is** required for:
- `thinking: { type: 'between_tools' }` — absent from 0.74.0's `ThinkingConfigParam`
  (which is `Enabled | Disabled | Adaptive` only), present in 0.129.0.
- `effort: 'xhigh'` — 0.129.0 widens the union.

55 minor versions behind is worth closing on its own merits, but do it as a **separate change**.
Bundling an SDK jump into an urgent model migration means that if something breaks you cannot tell
which of the two caused it.

## Editorial risk — the one that is not technical

Sonnet 5.5 "writes and communicates more clearly than its predecessor." `write-intro`,
`write-section` and `write-shortlist` produce **reader-facing prose** in a house voice that the
prompts work hard to constrain (`src/prompts/write-intro.ts`, `write-section.ts`). A model
generation change is a voice change, and no test in the repo will catch it.

Before flipping production: **generate one full issue and read it.** Compare against the previous
issue. If the voice drifts, the fix is prompt work, not a rollback — but you want to find it
before subscribers do. The `signalfield`/Brainscriblr publish path already writes to a staging
surface, so this is cheap to do.

## Work items

1. `src/llm/anthropic.ts` — replace the hardcoded ID with `getModel()` reading
   `config.anthropic.model`, defaulting to `claude-sonnet-5-5`.
2. Add `effort?` to `chatWithClaude`'s params and pass it as `output_config: { effort }`.
3. Set effort at all 7 call sites per the table above.
4. Raise `maxTokens` 2048 → 8192 at `write-shortlist.ts:56`, `ai-discoveries.ts:124`,
   `ai-for-good.ts:130`.
5. Throw on `stop_reason === 'max_tokens'` in the client.
6. Add `ANTHROPIC_MODEL` to `wrangler.toml` `[vars]`, `.env.example`, `src/config.ts`,
   `src/llm/api-keys.ts`, `src/worker/config.ts`, `src/worker/lib/config.ts`, and the `Env`
   interface in `src/worker/index.ts` — the same seven-surface pattern the Jev spec documents for
   `OPENROUTER_API_KEY`.
7. Fix the stale comments at `src/generate/index.ts:179` and `:189` — both say "via Kimi K2" but
   the code calls `chatWithClaude`.
8. Generate one issue locally, read it end to end, diff the voice against the previous issue.
9. Deploy, then watch the first production cron run (`0 8 * * 3`, `0 8 * * 6`).

Follow-ups, separately scoped: prompt caching (item 5 above); SDK 0.74.0 → 0.129.0;
`thinking: {type: 'between_tools'}` once the SDK is upgraded, if measured thinking spend on
`select-stories` justifies it.

## Dead code found while verifying

`src/llm/kimi.ts` exports `kimiClient` and `chatWithKimi` — **zero callers** anywhere in `src/`.
`MOONSHOT_API_KEY` is wired through `.env.example`, `src/config.ts:33-35`,
`src/worker/config.ts`, `src/worker/lib/config.ts`, `apiKeys.moonshot`, and assigned in both
`handlers/evaluate.ts:45` and `handlers/generate.ts:50` — all for a client nothing calls.

The stale "via Kimi K2" comments suggest stage 5 was moved from Kimi to Claude and the client was
left behind. Removing it is unrelated to this upgrade and should not be bundled with it, but it is
a secret and a dependency (`moonshot` config surface) that can go.

## Verification

- `npm run build` (`tsc`) clean.
- `npm test` (vitest) green — note no existing test covers `anthropic.ts`, so this change ships
  without a unit-test safety net unless one is added.
- Each of the 7 call sites exercised at least once against a real issue generation, with
  `stop_reason` logged, confirming none hit `max_tokens`.
- Record `usage.output_tokens` per call site before and after. If thinking overhead makes the
  `medium`-effort calls materially more expensive at $10/MTok than they were at $15/MTok, step
  them down to `low` and re-measure.
- Generated issue reads correctly — no truncated JSON, no schema failures, voice intact.
- Full pipeline: ingest → generate → publish, end to end, on a real date.

## Rollback

Set `ANTHROPIC_MODEL = "claude-sonnet-4-6"` in `wrangler.toml` and redeploy — a config change, no
code revert.

Note that `claude-sonnet-4-5-20250929` is **no longer a safe rollback target**: its retirement
commitment expired 2026-09-29 and it costs 50% more than 5.5. `claude-sonnet-4-6` (floor
2027-02-17) is the standing fallback, and unlike 5.5 it accepts `thinking: {type:"disabled"}` —
which matters if thinking overhead turns out to be the problem being rolled back from.

---

## Implementation notes (2026-09-30)

Items 1–7 shipped. Deviations from the plan:

1. **`src/worker/config.ts` and `src/worker/lib/config.ts` were left untouched.** Plan item 6 listed
   them as wiring surfaces; grep shows `getWorkerEnv` and `getConfig` have **zero callers**. Both
   files are dead, so adding `ANTHROPIC_MODEL` there would have been churn in code nothing runs.
   The live surfaces are `src/config.ts`, `src/llm/api-keys.ts`, the `Env` interface in
   `src/worker/index.ts`, and the handlers' `apiKeys.*` assignments.
2. **`anthropicModel` rides the `apiKeys` global** even though it is not a secret. `config` is
   frozen at module load and is `''` in the Worker, so anything sourced from env at invocation time
   has to use that global — it is the only established mechanism. Commented in place so nobody
   "cleans it up" into a secret.
3. **`chat()` now honours its `model` param.** `LLMClient.chat` already declared `model?: string`
   and the old implementation silently ignored it. Resolution order is
   `params.model → config.anthropic.model → apiKeys.anthropicModel → DEFAULT_MODEL`.
4. **`effort` is omitted when unset** rather than defaulted in the client. A central default would
   hide which call sites had actually been reviewed; omitting `output_config` reproduces the
   previous behaviour exactly. All 7 call sites set it explicitly.

### Verification performed

- `npx tsc --noEmit`: **29 errors before, 29 after** — identical error set. The repo's build was
  already failing on `main`; none of the 29 are in a file touched here. `npm run build` is not a
  usable gate in this repo until those are cleared.
- `npm test`: **11 failed / 78 passed → 10 failed / 113 passed.** The one fixed failure is the
  pre-existing `evaluate.test.ts` assertion, addressed in the Jev build. The 10 remaining are all
  pre-existing: `publish.test.ts` (stale Ghost tests left over from commit `7b71f96`) plus
  `feeds.test.ts` / `normalize.test.ts`, which fail to collect entirely.
- `dist/` is tracked in git but listed in `.gitignore:9`, so `npm run build` rewrites it. That
  accidental change was reverted; this diff is source-only. Worth a `git rm --cached dist/`.

### Not verified — needs a human

- **No live Sonnet 5.5 call has been made.** Plan item 8 is the real gate: generate one issue and
  read it. `write-intro` / `write-section` / `write-shortlist` produce reader-facing prose in a
  house voice, and no test here would catch a voice drift.
- Measured `usage.output_tokens` per call site, to confirm the effort choices and that thinking
  overhead at $10/MTok does not erase the 33% unit-price cut.
- That `output_config.effort` is accepted by the account in use — it being present in the SDK types
  is not the same as it being enabled server-side.

