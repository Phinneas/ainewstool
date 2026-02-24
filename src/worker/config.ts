/**
 * Worker-specific configuration
 * Does not import dotenv - uses Cloudflare env bindings directly
 */

export interface WorkerEnv {
  FIRECRAWL_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  MISTRAL_API_KEY: string;
  MOONSHOT_API_KEY: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
}

export function getWorkerEnv(env: WorkerEnv) {
  return {
    firecrawl: {
      apiKey: env.FIRECRAWL_API_KEY,
      timeout: 30000,
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
  };
}
