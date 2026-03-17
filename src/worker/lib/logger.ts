/**
 * Structured logger and pipeline metrics for Workers environment.
 *
 * Usage:
 *   import { Logger, PipelineMetrics } from './logger.js';
 *
 *   const log = new Logger('stage-1').withContext(ingestId);
 *   log.info('feed fetch complete', { fetched: 42 });
 *
 *   const metrics = new PipelineMetrics(env.INGEST_STATE, ingestId);
 *   await metrics.increment('fetched', 42);
 */

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  context: string;
  run_id?: string;
  [key: string]: unknown;
}

export class Logger {
  private context: string;
  private runId?: string;

  constructor(context: string = 'worker') {
    this.context = context;
  }

  /** Return a new Logger with a run_id attached to every log entry. */
  withContext(runId: string): Logger {
    const child = new Logger(this.context);
    child.runId = runId;
    return child;
  }

  info(message: string, data?: Record<string, unknown>): void {
    console.log(JSON.stringify(this.entry('info', message, data)));
  }

  warn(message: string, data?: Record<string, unknown>): void {
    console.warn(JSON.stringify(this.entry('warn', message, data)));
  }

  error(message: string, data?: Record<string, unknown>): void {
    console.error(JSON.stringify(this.entry('error', message, data)));
  }

  debug(message: string, data?: Record<string, unknown>): void {
    console.debug(JSON.stringify(this.entry('debug', message, data)));
  }

  /** Start a named timer; call .end() to log duration. */
  timer(name: string): { end: () => void } {
    const start = Date.now();
    return {
      end: () => this.info(`${name} completed`, { duration_ms: Date.now() - start }),
    };
  }

  private entry(
    level: LogEntry['level'],
    message: string,
    data?: Record<string, unknown>
  ): LogEntry {
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: this.context,
      ...(this.runId && { run_id: this.runId }),
      ...(data ?? {}),
    };
  }
}

// ---------------------------------------------------------------------------
// PipelineMetrics — KV-backed counters per run
// ---------------------------------------------------------------------------

/**
 * Tracks per-run counters in KV under `metrics:run:{runId}`.
 * Not atomic (read-modify-write), but race conditions are negligible given
 * sequential within-stage execution and 7-day TTL.
 */
export class PipelineMetrics {
  private readonly key: string;
  private readonly ttl = 60 * 60 * 24 * 7; // 7 days

  constructor(
    private readonly kv: KVNamespace,
    runId: string,
    keyPrefix: 'metrics:run' | 'metrics:generate' = 'metrics:run'
  ) {
    this.key = `${keyPrefix}:${runId}`;
  }

  async increment(field: string, by = 1): Promise<void> {
    const current = (await this.kv.get<Record<string, number>>(this.key, 'json')) ?? {};
    current[field] = (current[field] ?? 0) + by;
    current.updated_at = Date.now();
    await this.kv.put(this.key, JSON.stringify(current), { expirationTtl: this.ttl });
  }

  async set(field: string, value: unknown): Promise<void> {
    const current = (await this.kv.get<Record<string, unknown>>(this.key, 'json')) ?? {};
    current[field] = value;
    current.updated_at = Date.now();
    await this.kv.put(this.key, JSON.stringify(current), { expirationTtl: this.ttl });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the ingest run ID from a batch ID (e.g. "ingest-xxx-batch-2" → "ingest-xxx"). */
export function ingestIdFromBatchId(batchId: string): string {
  return batchId.replace(/-batch-\d+$/, '');
}
