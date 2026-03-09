// Check if we're in Worker environment
const isWorker = typeof process === 'undefined' || !process?.env?.NODE_ENV;
// In Node.js, load dotenv dynamically to avoid Worker bundling issues
if (!isWorker) {
    try {
        // Using require() syntax which is handled better by bundlers
        const dotenv = require('dotenv');
        dotenv.config({ override: true });
    }
    catch (e) {
        // dotenv not available in Worker bundle
    }
}
// Config values - never throw in Worker context
export const config = {
    s3: {
        endpoint: isWorker ? '' : (process.env.S3_ENDPOINT || ''),
        accessKeyId: isWorker ? '' : (process.env.S3_ACCESS_KEY_ID || ''),
        secretAccessKey: isWorker ? '' : (process.env.S3_SECRET_ACCESS_KEY || ''),
        bucket: isWorker ? '' : (process.env.S3_BUCKET || 'data-ingestion'),
        region: isWorker ? '' : (process.env.S3_REGION || 'auto'),
    },
    firecrawl: {
        apiKey: isWorker ? '' : (process.env.FIRECRAWL_API_KEY || ''),
    },
    anthropic: {
        apiKey: isWorker ? '' : (process.env.ANTHROPIC_API_KEY || ''),
    },
    mistral: {
        apiKey: isWorker ? '' : (process.env.MISTRAL_API_KEY || ''),
    },
    moonshot: {
        apiKey: isWorker ? '' : (process.env.MOONSHOT_API_KEY || ''),
    },
    reddit: {
        clientId: isWorker ? '' : (process.env.REDDIT_CLIENT_ID || ''),
        clientSecret: isWorker ? '' : (process.env.REDDIT_CLIENT_SECRET || ''),
    },
    exa: {
        apiKey: isWorker ? '' : (process.env.EXA_API_KEY || ''),
    },
};
