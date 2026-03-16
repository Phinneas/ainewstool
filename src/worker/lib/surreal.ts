/**
 * SurrealDB HTTP client for Cloudflare Workers.
 * Uses the SurrealDB REST API with Basic auth — no persistent session,
 * credentials sent with every request.
 *
 * Docs: https://surrealdb.com/docs/surrealdb/integration/http
 */

export interface SurrealConfig {
  url: string;        // e.g. https://scraper-xxx.aws-euw1.surreal.cloud
  namespace: string;  // ainewsletter
  database: string;   // production
  user: string;
  pass: string;
}

interface SurrealResult<T = unknown> {
  status: 'OK' | 'ERR';
  time: string;
  result?: T;
  detail?: string;
}

export class SurrealClient {
  private headers: Record<string, string>;
  private endpoint: string;

  constructor(private config: SurrealConfig) {
    const creds = btoa(`${config.user}:${config.pass}`);
    this.headers = {
      'Authorization': `Basic ${creds}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'surreal-ns':    config.namespace,
      'surreal-db':    config.database,
    };
    this.endpoint = `${config.url.replace(/\/$/, '')}/sql`;
  }

  /**
   * Execute one or more SurrealQL statements.
   * Returns the result array from the last statement.
   */
  async query<T = unknown>(
    sql: string,
    vars?: Record<string, unknown>
  ): Promise<T[]> {
    const body = vars
      ? JSON.stringify({ query: sql, vars })
      : sql;

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': vars ? 'application/json' : 'text/plain',
      },
      body,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SurrealDB HTTP ${res.status}: ${text}`);
    }

    const results = (await res.json()) as SurrealResult<T[]>[];
    const last = results[results.length - 1];

    if (last?.status === 'ERR') {
      throw new Error(`SurrealDB query error: ${last.detail}`);
    }

    return last?.result ?? [];
  }

  /**
   * Execute a statement and return the first result, or null.
   */
  async queryOne<T = unknown>(
    sql: string,
    vars?: Record<string, unknown>
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, vars);
    return rows[0] ?? null;
  }

  /**
   * Upsert an article record. Uses URL as the unique key.
   * Returns the article record id.
   */
  async upsertArticle(data: {
    title: string;
    url: string;
    uploadKey: string;
    sourceUrl: string;
    publishedAt: string | null;
    isPdf?: boolean;
  }): Promise<string | null> {
    const sql = `
      LET $existing = (SELECT id FROM article WHERE url = $url LIMIT 1);
      IF array::len($existing) > 0 THEN
        RETURN $existing[0].id
      ELSE
        LET $source = (SELECT id FROM source WHERE url = $sourceUrl LIMIT 1)[0].id;
        LET $rec = (CREATE article CONTENT {
          title:       $title,
          url:         $url,
          upload_key:  $uploadKey,
          source:      $source,
          published_at: $publishedAt,
          status:      'claimed',
          is_pdf:      $isPdf
        })[0];
        RETURN $rec.id
      END;
    `;

    try {
      const result = await this.queryOne<string>(sql, {
        url:         data.url,
        title:       data.title,
        uploadKey:   data.uploadKey,
        sourceUrl:   data.sourceUrl,
        publishedAt: data.publishedAt ? new Date(data.publishedAt).toISOString() : null,
        isPdf:       data.isPdf ?? false,
      });
      return result ?? null;
    } catch (err) {
      console.error('[Surreal] upsertArticle failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /**
   * Update an article's status and optional fields.
   */
  async updateArticle(
    url: string,
    fields: Partial<{
      status: string;
      relevanceScore: number;
      evalModel: string;
      rejectionReason: string;
      uploadKey: string;
    }>
  ): Promise<void> {
    const sets: string[] = [];
    const vars: Record<string, unknown> = { url };

    if (fields.status !== undefined)          { sets.push('status = $status');                     vars.status = fields.status; }
    if (fields.relevanceScore !== undefined)  { sets.push('relevance_score = $relevanceScore');    vars.relevanceScore = fields.relevanceScore; }
    if (fields.evalModel !== undefined)       { sets.push('eval_model = $evalModel');              vars.evalModel = fields.evalModel; }
    if (fields.rejectionReason !== undefined) { sets.push('rejection_reason = $rejectionReason');  vars.rejectionReason = fields.rejectionReason; }
    if (fields.uploadKey !== undefined)       { sets.push('upload_key = $uploadKey');              vars.uploadKey = fields.uploadKey; }

    if (sets.length === 0) return;

    await this.query(
      `UPDATE article SET ${sets.join(', ')} WHERE url = $url`,
      vars
    ).catch(err =>
      console.error('[Surreal] updateArticle failed:', err instanceof Error ? err.message : String(err))
    );
  }

  /**
   * Upsert a source record. Safe to call on every ingest run.
   */
  async upsertSource(data: {
    name: string;
    url: string;
    feedType: string;
    category: string;
  }): Promise<void> {
    await this.query(
      `UPDATE source SET
        name          = $name,
        feed_type     = $feedType,
        category      = $category,
        last_fetched_at = time::now()
       WHERE url = $url;
       IF (SELECT count() FROM source WHERE url = $url)[0].count = 0 THEN
         CREATE source CONTENT {
           name:     $name,
           url:      $url,
           feed_type: $feedType,
           category: $category
         }
       END`,
      data
    ).catch(err =>
      console.error('[Surreal] upsertSource failed:', err instanceof Error ? err.message : String(err))
    );
  }

  /**
   * Query articles for newsletter generation.
   * Returns articles with relevance_score >= minScore ingested within the last N days.
   */
  async getArticlesForGeneration(opts: {
    minScore?: number;
    daysBack?: number;
    limit?: number;
  } = {}): Promise<Array<{
    id: string;
    title: string;
    url: string;
    upload_key: string;
    relevance_score: number;
    published_at: string;
  }>> {
    const minScore = opts.minScore ?? 0.6;
    const daysBack = opts.daysBack ?? 7;
    const limit    = opts.limit ?? 80;

    return this.query(
      `SELECT id, title, url, upload_key, relevance_score, published_at
       FROM article
       WHERE status IN ['evaluated', 'selected']
       AND relevance_score >= $minScore
       AND ingested_at > time::now() - ${daysBack}d
       ORDER BY relevance_score DESC
       LIMIT $limit`,
      { minScore, limit }
    ).catch(err => {
      console.error('[Surreal] getArticlesForGeneration failed:', err instanceof Error ? err.message : String(err));
      return [];
    }) as Promise<any[]>;
  }

  /**
   * Create an edition record and relate articles to it.
   */
  async createEdition(data: {
    generateId: string;
    dateRange: string[];
    articleUrls: string[];
    headerImageUrl?: string;
  }): Promise<string | null> {
    try {
      // Create the edition
      const edition = await this.queryOne<{ id: string }>(
        `CREATE edition CONTENT {
          generate_id:      $generateId,
          date_range:       $dateRange,
          status:           'generating',
          header_image_url: $headerImageUrl,
          article_count:    $articleCount
        }`,
        {
          generateId:      data.generateId,
          dateRange:       data.dateRange,
          headerImageUrl:  data.headerImageUrl ?? null,
          articleCount:    data.articleUrls.length,
        }
      );

      if (!edition?.id) return null;

      // Relate each article to the edition
      if (data.articleUrls.length > 0) {
        const relateSql = data.articleUrls.map((_, i) =>
          `LET $a${i} = (SELECT id FROM article WHERE url = $url${i} LIMIT 1)[0].id;
           IF $a${i} != NONE THEN RELATE $a${i}->featured_in->${edition.id} SET section = 'main' END;`
        ).join('\n');

        const relateVars: Record<string, string> = {};
        data.articleUrls.forEach((url, i) => { relateVars[`url${i}`] = url; });

        await this.query(relateSql, relateVars).catch(err =>
          console.error('[Surreal] createEdition relate failed:', err instanceof Error ? err.message : String(err))
        );
      }

      return edition.id;
    } catch (err) {
      console.error('[Surreal] createEdition failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /**
   * Update edition after publishing.
   */
  async updateEdition(generateId: string, fields: {
    status?: string;
    ghostPostId?: string;
    ghostUrl?: string;
    beehiivPostId?: string;
  }): Promise<void> {
    const sets: string[] = [];
    const vars: Record<string, unknown> = { generateId };

    if (fields.status !== undefined)      { sets.push('status = $status');           vars.status = fields.status; }
    if (fields.ghostPostId !== undefined) { sets.push('ghost_post_id = $ghostPostId'); vars.ghostPostId = fields.ghostPostId; }
    if (fields.ghostUrl !== undefined)    { sets.push('ghost_url = $ghostUrl');       vars.ghostUrl = fields.ghostUrl; }
    if (fields.beehiivPostId !== undefined) { sets.push('beehiiv_post_id = $beehiivPostId'); vars.beehiivPostId = fields.beehiivPostId; }

    if (sets.length === 0) return;

    await this.query(
      `UPDATE edition SET ${sets.join(', ')} WHERE generate_id = $generateId`,
      vars
    ).catch(err =>
      console.error('[Surreal] updateEdition failed:', err instanceof Error ? err.message : String(err))
    );
  }
}

/**
 * Create a SurrealClient from Worker environment variables.
 * Returns null if credentials are not configured.
 */
export function createSurrealClient(env: {
  SURREALDB_URL?: string;
  SURREALDB_NS?: string;
  SURREALDB_DB?: string;
  SURREALDB_USER?: string;
  SURREALDB_PASS?: string;
}): SurrealClient | null {
  if (!env.SURREALDB_URL || !env.SURREALDB_USER || !env.SURREALDB_PASS) {
    return null;
  }
  return new SurrealClient({
    url:       env.SURREALDB_URL,
    namespace: env.SURREALDB_NS ?? 'ainewsletter',
    database:  env.SURREALDB_DB ?? 'production',
    user:      env.SURREALDB_USER,
    pass:      env.SURREALDB_PASS,
  });
}
