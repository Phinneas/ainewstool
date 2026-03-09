# Beehiiv Integration — Implementation Spec

## Current State

The publish pipeline has one destination: Ghost CMS.

- `src/worker/handlers/publish.ts` — consumes `PUBLISH_QUEUE`, creates a Ghost draft via Admin API JWT
- `src/worker/handlers/generate.ts` — after generation, enqueues `{ type: 'publish', newsletter, generateId, dates }` to `PUBLISH_QUEUE`
- `src/worker/index.ts` — routes `publish-queue` messages to `handlePublishQueue`

Both Ghost and Beehiiv should receive every newsletter. A failure in one must not block or affect the other. Ghost continues as-is (web archive, SEO). Beehiiv is the actual send mechanism.

---

## What Needs to Be Built

### Goal

Add Beehiiv as a parallel publish destination within the existing `publish-queue` handler. Ghost draft creation is unchanged. Beehiiv post creation is added alongside it. Both are gated by independent dedup keys so a retry of one doesn't double-publish the other.

---

## Architecture

### 1. Refactor `publish.ts` into Two Functions

The existing monolithic handler becomes two named functions called in sequence with independent error handling:

```
handlePublishQueue(batch)
  └── for each message:
        ├── publishToGhost(message, env)     ← existing logic, extracted
        └── publishToBeehiiv(message, env)   ← new
```

Each function:
- Has its own dedup key in KV (`published:ghost:{generateId}`, `published:beehiiv:{generateId}`)
- Catches and logs its own errors
- Does **not** throw — failure of one does not prevent the other from running
- Writes an error key to KV on failure for observability

The outer `handlePublishQueue` throws only if **both** destinations fail (so the queue retries).

---

### 2. Beehiiv API Integration

**Endpoint:** `POST https://api.beehiiv.com/v2/publications/{publication_id}/posts`

**Auth:** `Authorization: Bearer {BEEHIIV_API_KEY}`

**Request body:**
```typescript
{
  title: string;               // Newsletter subject line (stripped of leading "# ")
  subtitle: string;            // Preheader / PLUS: line (used as preview text)
  status: "draft";             // Always draft — reviewed and sent from Beehiiv dashboard
  free_web_content: string;    // Full HTML body for web readers
  free_email_content: string;  // Same HTML body — Beehiiv wraps in their own email template
  displayed_date?: number;     // Unix timestamp (ms) — use Date.now()
}
```

**Content note:** Beehiiv wraps `free_email_content` in their own branded email template. Send only the body HTML (headings, paragraphs, links, lists, `<hr>` dividers) — **not** the full email template from `src/email/send.ts`. The existing `markdownToHtml()` in `publish.ts` produces suitable body HTML and can be reused directly.

**Draft status:** Posts are created as `"draft"`. The user reviews in the Beehiiv dashboard and clicks Send (or schedules) from there. This matches the Ghost workflow (also drafts).

---

### 3. New Environment Variables

Add to `Env` interface in `src/worker/index.ts`:

```typescript
BEEHIIV_API_KEY: string;         // Bearer token from Beehiiv API settings
BEEHIIV_PUBLICATION_ID: string;  // Publication ID from Beehiiv (pub_xxxxxxxx)
```

Both are optional at type level (`string | undefined`) so the worker still deploys without them — Beehiiv publish is skipped with a warning log if either is absent.

---

### 4. KV Dedup Keys

| Key | Value | TTL |
|-----|-------|-----|
| `published:ghost:{generateId}` | `{ postId, postUrl, title, timestamp }` | 30 days |
| `published:beehiiv:{generateId}` | `{ postId, webUrl, title, timestamp }` | 30 days |
| `error:ghost:{generateId}` | `{ error, timestamp }` | 7 days |
| `error:beehiiv:{generateId}` | `{ error, timestamp }` | 7 days |

The `published:ghost:` key currently stores under `published:{generateId}` — this needs to be migrated to the namespaced key to avoid a dedup collision. One-time migration: update the write in `publishToGhost()` and read both old and new keys during the dedup check for one release cycle.

---

## Files Affected

| File | Action |
|------|--------|
| `src/worker/handlers/publish.ts` | **Refactor** — extract `publishToGhost()`, add `publishToBeehiiv()`, update orchestration |
| `src/worker/index.ts` | **Modify** — add `BEEHIIV_API_KEY` and `BEEHIIV_PUBLICATION_ID` to `Env` |
| `wrangler.toml` | **Modify** — add two new secrets |

No new files. No queue changes. No changes to generate handler or upstream pipeline.

---

## `publishToBeehiiv` — Function Signature and Logic

```typescript
async function publishToBeehiiv(
  message: PublishMessage,
  env: Env
): Promise<void>
```

**Steps:**
1. Guard: if `BEEHIIV_API_KEY` or `BEEHIIV_PUBLICATION_ID` missing → log warning, return
2. Dedup check: read `published:beehiiv:{generateId}` from KV → skip if present
3. Parse title from first line (`# Subject`)
4. Parse subtitle from `PLUS:` line
5. Strip title and subtitle lines from body (same logic as Ghost handler)
6. Convert body markdown to HTML via `markdownToHtml()`
7. POST to Beehiiv API
8. On success: write dedup key to KV
9. On API error: write error key to KV, log error, **do not throw**

---

## HTML Content Strategy

Beehiiv renders `free_email_content` inside their email frame (header, footer, unsubscribe link) — send only the newsletter body.

The existing `markdownToHtml()` in `publish.ts` already produces clean body HTML. No changes needed there. The output is appropriate for both Ghost mobiledoc wrapping and Beehiiv direct body content.

Do **not** use `wrapInEmailTemplate()` from `src/email/send.ts` — that produces a full standalone email with custom header/footer that will conflict with Beehiiv's template.

---

## Error Handling & Retry Behavior

```
publishToGhost → catches error, writes error:ghost KV, does NOT throw
publishToBeehiiv → catches error, writes error:beehiiv KV, does NOT throw

After both:
  if both failed → throw (queue retries whole message)
  if one failed  → log, do NOT throw (no retry — partial success)
  if both succeeded → dedup keys written, done
```

Rationale for "no retry on partial success": Cloudflare queue retries replay the entire message. If Ghost succeeds and Beehiiv fails, a retry would attempt to re-run both. Ghost's dedup key prevents double-publishing there, so retrying is safe — but Beehiiv's error should be visible in KV for manual inspection rather than silently retried forever. The `error:beehiiv:{generateId}` key serves as the failure record.

---

## `wrangler.toml` Changes

```toml
[vars]
# ... existing vars ...

[[secrets]]
# ... existing secrets ...
BEEHIIV_API_KEY = ""         # set via: wrangler secret put BEEHIIV_API_KEY
BEEHIIV_PUBLICATION_ID = ""  # set via: wrangler secret put BEEHIIV_PUBLICATION_ID
```

Actual secret values set via:
```
wrangler secret put BEEHIIV_API_KEY
wrangler secret put BEEHIIV_PUBLICATION_ID
```

---

## Implementation Order

1. Add `BEEHIIV_API_KEY` and `BEEHIIV_PUBLICATION_ID` to `Env` interface in `index.ts`
2. Refactor `publish.ts`: extract existing Ghost logic into `publishToGhost()`, update dedup key name
3. Add `publishToBeehiiv()` with API call and KV dedup
4. Update `handlePublishQueue()` orchestration (run both, throw only if both fail)
5. Add secrets to `wrangler.toml` (as comments/placeholders)
6. `wrangler secret put` for both keys in the deployment environment

---

## Open Questions Before Implementation

1. **Beehiiv post status after review** — Should there be a mechanism to trigger sending from the Beehiiv dashboard (manual), or is fully manual fine for now? (Assumed: manual is fine — same as Ghost draft workflow.)
2. **Dedup key migration** — The existing `published:{generateId}` key (no `ghost:` prefix) will still exist for previously published newsletters. The updated `publishToGhost()` should check both old and new key formats during a one-release transition window.
3. **Beehiiv publication ID** — Needs to be retrieved from the Beehiiv dashboard (Settings → API) before deployment.
4. **Tags** — Beehiiv supports tags on posts. Should `AI` and `Newsletter` tags be applied? (Matches what's being done on Ghost.)
5. **`displayed_date`** — Use `Date.now()` (current timestamp) or parse from `message.dates[0]`? The newsletter covers a date range — either convention works.
