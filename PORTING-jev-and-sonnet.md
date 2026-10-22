# Porting the Sonnet 5.5 + Jev changes to the other news tools

Companion to `SPEC-upgrade-sonnet-5-5.md` and `SPEC-judge-with-jev.md`. Both changes landed in
`ainewsletter-ingest` on 2026-09-30. This is what carries over, what must be re-authored, and what
to check in the target repo before starting.

Two independent changes. **Port the Sonnet upgrade first** — it is urgent there too if the sibling
tools also hardcode `claude-sonnet-4-5-20250929`, whose retirement commitment expired 2026-09-29.

---

## 1. Sonnet 5.5

### Check first

```bash
grep -rn "claude-sonnet-4-5\|claude-3-\|claude-sonnet-4-20" src/
node -e "console.log(require('./node_modules/@anthropic-ai/sdk/package.json').version)"
grep -rn "maxTokens:" src/ | sort -t: -k3 -n
```

The third command is the important one. **Any call site at or below 4096 `maxTokens` is at risk**
once adaptive thinking is on, because thinking tokens count toward that ceiling. In this repo
three sites were at 2048 and would have truncated their JSON.

### Copy verbatim

| Source | What it carries |
|---|---|
| `src/llm/types.ts` | `ClaudeEffort` type + `effort?` on `LLMClient.chat` |
| `src/llm/anthropic.ts` | `DEFAULT_MODEL`, `getModel()`, `output_config` spread, `stop_reason` guard |

`anthropic.ts` is the whole pattern in 66 lines. The four things that matter:

1. Model ID resolved at call time from config, never hardcoded.
2. `...(effort ? { output_config: { effort } } : {})` — omitted when unset, so un-reviewed call
   sites behave exactly as before rather than silently changing cost.
3. Throw on `stop_reason === "max_tokens"`. Without this, truncation surfaces as a zod schema
   error two layers up and you debug the prompt instead of the budget.
4. `.find(b => b.type === "text")` still works — the content array now carries `thinking` blocks
   ahead of the text, but picking by type selects the right one.

### Re-author per tool

**The effort level at every call site.** This repo's split was `medium` for genuine judgement
(story selection, section writing) and `low` for short scoped output (subject line, intro,
shortlists). That mapping depends on what each call site actually does — do not copy it blindly.

**Every `maxTokens` ceiling.** Raise anything at 2048 to 8192. `max_tokens` is a ceiling, not a
reservation: you are billed for tokens generated, so raising it is free insurance.

### Dependencies

None new. `output_config.effort` with `low|medium|high|max` exists in SDK **0.74.0**, and
`claude-sonnet-5-5` type-checks without an upgrade because the `Model` union ends with
`| (string & {})`. An upgrade to 0.129.0 is only needed for `thinking: {type: "between_tools"}`
and `effort: "xhigh"`.

### The gate that is not automated

Generate one issue per tool and **read it**. Model-generation changes are voice changes, and
`write-intro`-style prose is constrained by prompts, not tests. Nothing in CI will catch drift.

---

## 2. Jev

### Copy verbatim

`src/llm/jev.ts` is **fully generic** — no project-specific logic. Its only two imports outside
the stdlib are `../config.js` and `./api-keys.js`, and it touches exactly one field on each:

```ts
config.openrouter.apiKey
apiKeys.openrouter
```

If the target repo has neither pattern, replace `getApiKey()` with a direct env read and the file
ports as-is. Everything else in it is Jev protocol: question/answer types, zod schemas,
`JevPayloadTooLargeError` vs `JevError`, backoff honouring `Retry-After`, and the three
`readNoul` / `readChoice` / `readScore` helpers.

Also copy from `src/ingest/evaluate.ts` — these are generic and well-tested:

| Export | Why it ports |
|---|---|
| `boundForState()` | 32K context guard. Pure function, no domain knowledge. |
| `acceptNews()` | Three-band threshold. Pure function. |
| `combineResearchScore()` | Weighted-axis → 1–10 mapping. Pure function. |
| `readEvalSettings()` | env resolution with override precedence. |
| the 413 halve-and-retry block | Provider-agnostic recovery. |

`tests/evaluate.test.ts` has direct unit tests for all four pure functions — copy those test blocks
too, they need no rewriting.

### Re-author per tool — this is the real work

**`NEWS_QUESTIONS`.** The `criteria.true` / `criteria.false` strings encode *"is this worth putting
in an AI/tech newsletter"*. A different tool has a different topic, so these are the single
biggest authoring task in the port. Rules that do carry over:

- The article goes in `state`, never in `instructions`. Repeating it doubles input spend.
- No JSON-format block. There is no text output to format — which also deletes the `parseJson`
  recovery path and its regex fallback.
- The `choice` question **must** have an escape option (`belongs`). A choice always picks one of
  the listed options; without an escape, every *accepted* item gets a bogus rejection tag.
- Delete any "be reasonably inclusive" style sentence from the old prompt. That sentence **was**
  the threshold. Jev never sees it, so the bias has to move into `RELEVANCE_THRESHOLD`.

**`RELEVANCE_THRESHOLD`.** 0.35 here is a reasoned starting value, *not calibrated* — this repo
has not run shadow mode yet either. Each tool needs its own shadow run. The bias direction does
carry over if the pipeline shape matches: a false accept costs one slot in a shortlist that a
stronger model filters again; a false reject is cached and the item is gone from that issue.
Optimise recall at stage 3, precision at stage 5.

**`REJECTION_TAG` taxonomy.** The six tags here come from the old prompt's NOT-relevant list.
Derive the target tool's tags the same way — from whatever its existing exclusion rules are.

**`RESEARCH_QUESTIONS` + `RESEARCH_WEIGHTS`.** Only if the tool has a research tier. The 40/35/25
weighting and the 5-level scales encode this newsletter's editorial judgement. Keep the *shape*
(three short ordered scales in one request, combined in code) and re-derive the content. Do not
collapse the rubric into one 10-level score question — that silently discards the weighting.

### Wiring — four live surfaces, not eight

The spec originally listed eight config surfaces. Two of them
(`src/worker/config.ts`, `src/worker/lib/config.ts`) turned out to be **dead code with zero
callers**. Check whether the target repo has equivalents before wiring anything:

```bash
grep -rn "getWorkerEnv\|getConfig" src/ | grep -v "worker/config.ts\|worker/lib/config.ts"
```

The surfaces that actually matter:

1. `src/config.ts` — `openrouter: { apiKey: isWorker ? '' : (process.env.OPENROUTER_API_KEY || '') }`
2. `src/llm/api-keys.ts` — `openrouter: string` in **both** the `declare global` shape and the
   `globalThis.__apiKeys` initializer (missing either one is a runtime crash, not a type error)
3. `src/worker/index.ts` — `OPENROUTER_API_KEY?: string` in `Env`, plus `EVAL_PROVIDER` /
   `RELEVANCE_THRESHOLD` / `STATE_CHAR_BUDGET` as plain vars
4. the stage-3 handler — `apiKeys.openrouter = env.OPENROUTER_API_KEY ?? ''`, copy the three plain
   vars onto `process.env`, and dispatch on mode

Plus `[vars]` in `wrangler.toml`, `OPENROUTER_API_KEY=` in `.env.example`, and
`wrangler secret put OPENROUTER_API_KEY`.

### Ship it dark

`EVAL_PROVIDER = "mistral"` by default, then `shadow` for 2–3 cron cycles, then `jev`. Shadow
**acts on the incumbent provider** and only logs the Jev answer, so a bad threshold cannot thin a
live issue. Rollback is flipping the var back — no code revert.

Do not skip shadow. The threshold and the char budget are both unmeasured until you have the
`shadow jev comparison` logs, and `usage.input_tokens` from those runs is also what calibrates
`STATE_CHAR_BUDGET` against Jev's unpublished tokenizer.

---

## Order of work per tool

1. Grep for the hardcoded Sonnet 4.5 ID and every low `maxTokens`.
2. Port `types.ts` + `anthropic.ts`; set effort and raise ceilings at each call site.
3. Generate and **read** one issue.
4. Deploy, watch one cron run, check `usage.output_tokens` against expectations.
5. Then, separately: port `jev.ts` + the four pure functions + their tests.
6. Re-author the question criteria and the tag taxonomy for that tool's topic.
7. Wire the four surfaces, default `EVAL_PROVIDER = "mistral"`.
8. Shadow for 2–3 cycles, calibrate threshold and char budget from the logs.
9. Flip to `jev`.

Steps 1–4 are the urgent ones. Steps 5–9 are a cost and quality improvement with no deadline, and
they should not be bundled with the model migration — if something breaks you want to know which
of the two caused it.

## Things that will bite

- **`dist/` may be tracked-but-gitignored** here (`.gitignore:9`). If the sibling repos are the
  same, running `tsc` dirties the diff. Revert it, or `git rm --cached dist/`.
- **The build may already be failing.** This repo had 29 pre-existing type errors and 10 failing
  tests on `main` before any of this work. Establish the baseline with `git stash` **before**
  editing, or you will spend time diagnosing failures that are not yours.
- **Do not implement `LLMClient` for Jev.** That interface returns `Promise<string>`; serialising
  probabilities to a string to re-parse them reintroduces exactly the fragility the change removes.
- **Mistral stays.** `extract-sources.ts` and `generate-queries.ts` are generative and cannot use
  Jev. Only the relevance judgement moves. Check whether the sibling tools have the same split
  before removing any Mistral wiring.
