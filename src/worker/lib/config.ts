/**
 * Environment-based configuration for Workers
 */

export interface WorkerConfig {
  firecrawl: {
    apiKey: string;
    timeout: number;
    maxRetries: number;
  };
  anthropic: {
    apiKey: string;
  };
  mistral: {
    apiKey: string;
  };
  moonshot: {
    apiKey: string;
  };
  reddit: {
    clientId?: string;
    clientSecret?: string;
  };
  kv: {
    cacheTtl: {
      scrape: number;      // 7 days
      evaluate: number;    // 7 days
      failure: number;     // 1 day
    };
  };
  queues: {
    batchSize: {
      scrape: number;
      evaluate: number;
      upload: number;
    };
  };
}

export function getConfig(env: Record<string, string>): WorkerConfig {
  return {
    firecrawl: {
      apiKey: env.FIRECRAWL_API_KEY,
      timeout: 30000, // 30 seconds
      maxRetries: 2,
    },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
    },
    mistral: {
      apiKey: env.MISTRAL_API_KEY,
    },
    moonshot: {
      apiKey: env.MOONSHOT_API_KEY,
    },
    reddit: {
      clientId: env.REDDIT_CLIENT_ID,
      clientSecret: env.REDDIT_CLIENT_SECRET,
    },
    kv: {
      cacheTtl: {
        scrape: 604800,  // 7 days
        evaluate: 604800, // 7 days
        failure: 86400,  // 1 day
      },
    },
    queues: {
      batchSize: {
        scrape: 10,
        evaluate: 20,
        upload: 30,
      },
    },
  };
}
