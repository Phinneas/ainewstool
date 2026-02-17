import dotenv from "dotenv";
dotenv.config({ override: true });

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optionalEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  s3: {
    endpoint: requireEnv("S3_ENDPOINT"),
    accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    bucket: optionalEnv("S3_BUCKET", "data-ingestion"),
    region: optionalEnv("S3_REGION", "auto"),
  },
  firecrawl: {
    apiKey: requireEnv("FIRECRAWL_API_KEY"),
  },
  anthropic: {
    apiKey: requireEnv("ANTHROPIC_API_KEY"),
  },
  mistral: {
    apiKey: requireEnv("MISTRAL_API_KEY"),
  },
  moonshot: {
    apiKey: requireEnv("MOONSHOT_API_KEY"),
  },
  reddit: {
    clientId: optionalEnv("REDDIT_CLIENT_ID"),
    clientSecret: optionalEnv("REDDIT_CLIENT_SECRET"),
  },
} as const;
