# Spec: publish Brainscriblr to mymcpshelf instead of Ghost

**Status:** draft for review
**Worker:** `ainewsletter-ingest`
**Files:** `src/worker/handlers/publish.ts`, `src/worker/index.ts`, `wrangler.toml`

---

## Context

Brainscriblr's pipeline (ingest → scrape → evaluate → upload → generate → publish) ends by
posting the finished issue to the Ghost site at brainscriblr.world and, optionally, to Beehiiv.

Ghost is retired. The 30 historical Brainscriblr issues have already been migrated into
mymcpshelf as blog posts tagged `track: ai-field-notes`, and brainscriblr.world is being
allowed to lapse. Nothing consumes the Ghost endpoint any more, but the code still calls it —
and calls it **unguarded**, so the publish stage throws rather than degrading.

Goal: stage 6 writes the issue into the mymcpshelf content collection, and Ghost is removed.

## Current behaviour (verified in code)

`handlePublishQueue` (`publish.ts:~420`) does three things:

1. Renders a header image, then `uploadImageToGhost(...)` to host it and get `featureImageUrl`.
2. `Promise.all([publishToGhost(...), publishToBeehiiv(...)])`.
3. Records `ghost_ok` / `beehiiv_ok` metrics in KV.

Guarding is inconsistent:

| Call | Guarded? | Behaviour with no credentials |
|---|---|---|
| `publishToBeehiiv` | yes — checks both env vars, warns, returns `true` | skips cleanly |
| `publishToGhost` | **no** | `createGhostJwt(undefined)` throws |
| `uploadImageToGhost` | **no** | same, inside a `try/catch` for image errors only |

So removing the Ghost credentials without touching code turns a working pipeline into one that
crashes at the final stage.

Note Beehiiv cannot be automated on the current free plan — its Send/Post API is Enterprise-only.
Beehiiv publishing stays manual regardless of what this spec does.

## Target behaviour

Stage 6 writes a markdown file into the mymcpshelf Astro content collection:

```
mcp-website-directory/src/content/blog/<slug>.md
```

with frontmatter matching the existing 30 migrated issues:

```yaml
---
title: "<parsed.title>"
description: "<parsed.preheader>"
date: "<ISO 8601>"
author: "Chester Beard"
image: "<featureImageUrl, if any>"
track: ai-field-notes
---
```

Constraints already established by the site (do not re-derive):

- **No leading `# Title` in the body.** The post template renders the title as the page's only
  `<h1>`; a body H1 produces two. The Ghost→markdown migration stripped these.
- **Filename is the slug.** Astro reserves it. Slugify from the title.
- **Never start a filename with `_`** — Astro content collections silently ignore those.
- Escape `"` in YAML string values.
- `track: ai-field-notes` is what populates `/blog?track=ai-field-notes`,
  `/rss/ai-field-notes.xml`, and the "Read recent Brainscriblr posts" link on `/newsletters`.

## Open decision: how the Worker reaches the repo

A Worker cannot commit to git directly. Three options, in preference order.

### A. GitHub Contents API commit  — recommended

Worker `PUT`s to `/repos/Phinneas/mcp-website-directory/contents/src/content/blog/<slug>.md`
with a base64 body and a commit message. Cloudflare Pages sees the push and rebuilds.

- Fully automated end to end.
- Needs a fine-grained PAT (contents:write, that repo only) as an **encrypted secret**.
- Must handle: existing-file 409 (send `sha` to update, or skip), and base64 of UTF-8.

### B. Commit to a `pending/` path and open a PR

Same as A but writes to a branch and opens a PR, so an issue is reviewed before going live.

- Keeps a human gate, which matches the "subscribers get it a day early" policy.
- More API calls; needs branch cleanup.

### C. Worker stops at generate; publish runs from the CLI

Drop stage 6 entirely. The generated issue already lands in R2. A local
`tsx src/cli.ts shelf <date>` writes the post (this command already exists in the
`signalfield` repo and can be ported).

- Least code, no new credentials, no GitHub token in a Worker.
- Publishing stops being automatic — but Beehiiv is manual anyway, so the issue is already
  being handled by hand at that point.

**Recommendation: C now, A later.** Beehiiv's manual step means full automation buys little
today, and C removes the crash risk immediately with the least new surface. Revisit A if/when
Beehiiv sending is automated.

## Header image

Currently generated, then uploaded to Ghost for hosting. With Ghost gone it needs a home:

1. **R2 public bucket** — Worker already has R2 bindings; needs a public bucket or custom domain.
2. **Commit into the site repo** under `public/images/blog/` — same mechanism as the post.
3. **Drop it** — the 30 migrated issues use `images.unsplash.com` URLs and render fine, so the
   site does not require a locally hosted image.

Cheapest correct answer is 1 if images matter, 3 if they do not. Do not leave the Ghost upload
path in place.

## Work items

1. Delete `publishToGhost`, `createGhostJwt`, `uploadImageToGhost` from `publish.ts`.
2. Remove `GHOST_API_URL`, `GHOST_ADMIN_API_KEY`, `GHOST_CONTENT_API_KEY` from the `Env`
   interface (`worker/index.ts`), `.env.example`, and the Worker's stored variables.
3. Implement the chosen publish path (A, B or C).
4. Guard whatever remains, matching the Beehiiv pattern — warn and continue, never throw.
5. Update `ghost_ok` metric to reflect the new target, or remove it.
6. Decide the header-image home and implement or remove.
7. Port the `shelf` writer from `signalfield/src/shelf/index.ts` if choosing C.

## Verification

- Run the publish stage against a known `generateId`; a new `.md` appears in the collection.
- `pnpm build` in the site repo; the post renders and `/rss/ai-field-notes.xml` gains an item.
- Post body contains no `<h1>` beyond the template's own.
- Re-running the same `generateId` does not create a duplicate.
- Grep the repo for `ghost` — no live references remain.

## Out of scope

Beehiiv automation (Enterprise-only API), the brainscriblr.world 301, and the same rewiring
for Signal Field — which shares this architecture and should follow once this is proven.
