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

/**
 * D1 mock matching the chain the handler uses:
 * `env.MYMCPSHELF_DB.prepare(sql).bind(...args).run()`.
 */
function makeD1(runImpl?: () => Promise<unknown>) {
  const run = runImpl ? vi.fn(runImpl) : vi.fn().mockResolvedValue({ success: true });
  const bind = vi.fn().mockReturnValue({ run });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { prepare, bind, run };
}

function makeEnv(overrides: {
  d1?: ReturnType<typeof makeD1>;
  pexelsKey?: string;
  beehiivKey?: string;
  beehiivPubId?: string;
  kvGet?: (key: string) => Promise<string | null>;
  kvPut?: () => Promise<void>;
} = {}) {
  return {
    MYMCPSHELF_DB: overrides.d1 ?? makeD1(),
    PEXELS_API_KEY: overrides.pexelsKey,
    BEEHIIV_API_KEY: overrides.beehiivKey,
    BEEHIIV_PUBLICATION_ID: overrides.beehiivPubId,
    INGEST_STATE: {
      get: overrides.kvGet ?? vi.fn().mockResolvedValue(null),
      put: overrides.kvPut ?? vi.fn().mockResolvedValue(undefined),
    },
  };
}

/** Fetch mock that responds to Beehiiv with a non-2xx. */
function beehiivFailFetch(status = 422) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => 'Unprocessable Entity',
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handlePublishQueue', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('resolves when mymcpshelf succeeds and Beehiiv is not configured', async () => {
    const env = makeEnv();

    await expect(handlePublishQueue(makeBatch() as any, env as any)).resolves.toBeUndefined();
  });

  it('writes the mymcpshelf dedup key to KV after a successful publish', async () => {
    const kvPut = vi.fn().mockResolvedValue(undefined);
    const env = makeEnv({ kvPut });

    await handlePublishQueue(makeBatch() as any, env as any);

    const calls = kvPut.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls.some((k: string) => k.startsWith('published:mymcpshelf:'))).toBe(true);
  });

  it('throws (triggering queue retry) when mymcpshelf fails — even with no Beehiiv configured', async () => {
    const d1 = makeD1(async () => {
      throw new Error('D1 write failed');
    });
    const env = makeEnv({ d1 });

    await expect(handlePublishQueue(makeBatch() as any, env as any)).rejects.toThrow(
      /mymcpshelf publish failed/
    );
  });

  it('throws when mymcpshelf write fails', async () => {
    const d1 = makeD1(async () => {
      throw new Error('D1 write failed');
    });
    const env = makeEnv({ d1 });

    await expect(handlePublishQueue(makeBatch() as any, env as any)).rejects.toThrow();
  });

  it('stores the mymcpshelf error in KV before throwing', async () => {
    const d1 = makeD1(async () => {
      throw new Error('D1 write failed');
    });
    const kvPut = vi.fn().mockResolvedValue(undefined);
    const env = makeEnv({ d1, kvPut });

    await expect(handlePublishQueue(makeBatch() as any, env as any)).rejects.toThrow();

    const keys = kvPut.mock.calls.map((c: unknown[]) => c[0]);
    expect(keys.some((k: string) => k.startsWith('error:mymcpshelf:'))).toBe(true);
  });

  it('resolves when mymcpshelf succeeds but Beehiiv fails', async () => {
    vi.stubGlobal('fetch', beehiivFailFetch());
    const env = makeEnv({ beehiivKey: 'bh-key', beehiivPubId: 'pub-123' });

    await expect(handlePublishQueue(makeBatch() as any, env as any)).resolves.toBeUndefined();
  });

  it('skips mymcpshelf write when dedup key already exists in KV', async () => {
    const d1 = makeD1();
    const kvGet = vi.fn().mockImplementation(async (key: string) => {
      if (key === 'published:mymcpshelf:gen-test-001') return JSON.stringify({ slug: 'existing' });
      return null;
    });
    const env = makeEnv({ d1, kvGet });

    await handlePublishQueue(makeBatch() as any, env as any);

    expect(d1.prepare).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// parseNewsletter (tested indirectly via the D1 insert)
// ---------------------------------------------------------------------------

describe('newsletter parsing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the first # heading as the post title', async () => {
    const d1 = makeD1();
    const env = makeEnv({ d1 });

    const newsletter = '# My Custom Subject Line\n\nPLUS: more stuff\n\nBody text.';
    await handlePublishQueue(makeBatch({ newsletter }) as any, env as any);

    const bindArgs = d1.bind.mock.calls[0];
    expect(bindArgs[1]).toBe('My Custom Subject Line');
  });

  it('falls back to date-based title when the first line is blank', async () => {
    const d1 = makeD1();
    const env = makeEnv({ d1 });

    // First line is "# " — after stripping the prefix the result is empty.
    const newsletter = '# \n\nBody text.';
    await handlePublishQueue(makeBatch({ newsletter, dates: ['2026-03-14'] }) as any, env as any);

    const bindArgs = d1.bind.mock.calls[0];
    expect(bindArgs[1]).toBe('AI Newsletter — 2026-03-14');
  });

  it('extracts PLUS: line as the description', async () => {
    const d1 = makeD1();
    const env = makeEnv({ d1 });

    const newsletter = '# Subject\n\nPLUS: OpenAI and Google updates\n\nBody.';
    await handlePublishQueue(makeBatch({ newsletter }) as any, env as any);

    const bindArgs = d1.bind.mock.calls[0];
    expect(bindArgs[2]).toBe('PLUS: OpenAI and Google updates');
  });
});
