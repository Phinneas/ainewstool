import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePublishQueue } from '../src/worker/handlers/publish.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal newsletter markdown that parseNewsletter can handle */
const SAMPLE_NEWSLETTER = [
  '# AI Hits a New Milestone',
  'PLUS: OpenAI, Google, and more',
  '',
  'Big news this week in AI.',
  '',
  '## Story One',
  'Content here.',
].join('\n');

/** Valid Ghost Admin API key format: <id>:<64-char-hex-secret> */
const VALID_GHOST_KEY = 'abc123def456:' + 'aa'.repeat(32);

function makeMessage(overrides: Partial<{
  generateId: string;
  newsletter: string;
  dates: string[];
}> = {}) {
  return {
    type: 'publish' as const,
    generateId: overrides.generateId ?? 'gen-test-001',
    newsletter: overrides.newsletter ?? SAMPLE_NEWSLETTER,
    dates: overrides.dates ?? ['2026-03-14'],
    timestamp: Date.now(),
  };
}

function makeBatch(msgOverrides = {}) {
  return {
    queue: 'publish-queue',
    messages: [{ body: makeMessage(msgOverrides) }],
  };
}

function makeEnv(overrides: {
  ghostKey?: string;
  ghostUrl?: string;
  beehiivKey?: string;
  beehiivPubId?: string;
  kvGet?: (key: string) => Promise<string | null>;
  kvPut?: () => Promise<void>;
} = {}) {
  return {
    GHOST_ADMIN_API_KEY: overrides.ghostKey ?? VALID_GHOST_KEY,
    GHOST_API_URL: overrides.ghostUrl ?? 'https://example.ghost.io',
    BEEHIIV_API_KEY: overrides.beehiivKey,
    BEEHIIV_PUBLICATION_ID: overrides.beehiivPubId,
    INGEST_STATE: {
      get: overrides.kvGet ?? vi.fn().mockResolvedValue(null),
      put: overrides.kvPut ?? vi.fn().mockResolvedValue(undefined),
    },
  };
}

/** Returns a fetch mock that responds to Ghost with a 200 success */
function ghostSuccessFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      posts: [{ id: 'ghost-post-001', url: 'https://example.ghost.io/p/ghost-post-001/' }],
    }),
  });
}

/** Returns a fetch mock that responds to Ghost with a non-200 error */
function ghostFailFetch(status = 401, body = 'Unauthorized') {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => body,
  });
}

/**
 * URL-aware fetch mock — routes by hostname so Ghost and Beehiiv can be
 * controlled independently regardless of Promise.all execution order.
 */
function urlAwareFetch({
  ghostOk = true,
  beehiivOk = true,
}: { ghostOk?: boolean; beehiivOk?: boolean } = {}) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/ghost/api/')) {
      if (ghostOk) {
        return {
          ok: true,
          json: async () => ({
            posts: [{ id: 'ghost-post-002', url: 'https://example.ghost.io/p/002/' }],
          }),
        };
      }
      return { ok: false, status: 401, text: async () => 'Unauthorized' };
    }
    if (String(url).includes('beehiiv.com')) {
      if (beehiivOk) {
        return {
          ok: true,
          json: async () => ({ data: { id: 'bh-001', web_url: 'https://beehiiv.com/p/001' } }),
        };
      }
      return { ok: false, status: 422, text: async () => 'Unprocessable Entity' };
    }
    return { ok: false, status: 404, text: async () => 'Not found' };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handlePublishQueue', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('resolves when Ghost succeeds and Beehiiv is not configured', async () => {
    vi.stubGlobal('fetch', ghostSuccessFetch());
    const env = makeEnv();

    await expect(handlePublishQueue(makeBatch() as any, env as any)).resolves.toBeUndefined();
  });

  it('writes the dedup key to KV after a successful Ghost publish', async () => {
    vi.stubGlobal('fetch', ghostSuccessFetch());
    const kvPut = vi.fn().mockResolvedValue(undefined);
    const env = makeEnv({ kvPut });

    await handlePublishQueue(makeBatch() as any, env as any);

    // Should have stored published:ghost:<generateId>
    const calls = kvPut.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls.some((k: string) => k.startsWith('published:ghost:'))).toBe(true);
  });

  // ── Ghost failure must always retry ────────────────────────────────────────

  it('throws (triggering queue retry) when Ghost fails — even with no Beehiiv configured', async () => {
    vi.stubGlobal('fetch', ghostFailFetch(401));
    const env = makeEnv(); // no Beehiiv keys

    await expect(handlePublishQueue(makeBatch() as any, env as any)).rejects.toThrow(
      /Ghost publish failed/
    );
  });

  it('throws when Ghost fails with a 500 error', async () => {
    vi.stubGlobal('fetch', ghostFailFetch(500, 'Internal Server Error'));
    const env = makeEnv();

    await expect(handlePublishQueue(makeBatch() as any, env as any)).rejects.toThrow();
  });

  it('stores the Ghost error in KV before throwing', async () => {
    vi.stubGlobal('fetch', ghostFailFetch(401));
    const kvPut = vi.fn().mockResolvedValue(undefined);
    const env = makeEnv({ kvPut });

    await expect(handlePublishQueue(makeBatch() as any, env as any)).rejects.toThrow();

    const keys = kvPut.mock.calls.map((c: unknown[]) => c[0]);
    expect(keys.some((k: string) => k.startsWith('error:ghost:'))).toBe(true);
  });

  // ── Beehiiv failure is non-blocking ────────────────────────────────────────

  it('resolves when Ghost succeeds but Beehiiv fails', async () => {
    vi.stubGlobal('fetch', urlAwareFetch({ ghostOk: true, beehiivOk: false }));
    const env = makeEnv({ beehiivKey: 'bh-key', beehiivPubId: 'pub-123' });

    // Should NOT throw — Beehiiv is optional
    await expect(handlePublishQueue(makeBatch() as any, env as any)).resolves.toBeUndefined();
  });

  // ── Deduplication ──────────────────────────────────────────────────────────

  it('skips Ghost fetch when dedup key already exists in KV', async () => {
    const fetchMock = ghostSuccessFetch();
    vi.stubGlobal('fetch', fetchMock);

    // Simulate already-published
    const kvGet = vi.fn().mockImplementation(async (key: string) => {
      if (key === 'published:ghost:gen-test-001') return JSON.stringify({ postId: 'existing' });
      return null;
    });
    const env = makeEnv({ kvGet });

    await handlePublishQueue(makeBatch() as any, env as any);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips Ghost fetch when legacy dedup key (published:<id>) exists in KV', async () => {
    const fetchMock = ghostSuccessFetch();
    vi.stubGlobal('fetch', fetchMock);

    const kvGet = vi.fn().mockImplementation(async (key: string) => {
      if (key === 'published:gen-test-001') return JSON.stringify({ postId: 'legacy' });
      return null;
    });
    const env = makeEnv({ kvGet });

    await handlePublishQueue(makeBatch() as any, env as any);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// parseNewsletter (tested indirectly via successful publish)
// ---------------------------------------------------------------------------

describe('newsletter parsing', () => {
  it('uses the first # heading as the Ghost post title', async () => {
    vi.stubGlobal('fetch', ghostSuccessFetch());
    const kvPut = vi.fn().mockResolvedValue(undefined);
    const env = makeEnv({ kvPut });

    const newsletter = '# My Custom Subject Line\n\nPLUS: more stuff\n\nBody text.';
    await handlePublishQueue(makeBatch({ newsletter }) as any, env as any);

    // The Ghost fetch body should contain the title
    const [, fetchOptions] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchOptions.body);
    expect(body.posts[0].title).toBe('My Custom Subject Line');
  });

  it('falls back to date-based title when the first line is blank', async () => {
    vi.stubGlobal('fetch', ghostSuccessFetch());
    const kvPut = vi.fn().mockResolvedValue(undefined);
    const env = makeEnv({ kvPut });

    // First line is "# " — after stripping the prefix the result is empty
    const newsletter = '# \n\nBody text.';
    await handlePublishQueue(makeBatch({ newsletter, dates: ['2026-03-14'] }) as any, env as any);

    const [, fetchOptions] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchOptions.body);
    expect(body.posts[0].title).toBe('AI Newsletter — 2026-03-14');
  });

  it('extracts PLUS: line as the custom_excerpt', async () => {
    vi.stubGlobal('fetch', ghostSuccessFetch());
    const kvPut = vi.fn().mockResolvedValue(undefined);
    const env = makeEnv({ kvPut });

    const newsletter = '# Subject\n\nPLUS: OpenAI and Google updates\n\nBody.';
    await handlePublishQueue(makeBatch({ newsletter }) as any, env as any);

    const [, fetchOptions] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchOptions.body);
    expect(body.posts[0].custom_excerpt).toBe('PLUS: OpenAI and Google updates');
  });
});
