# Cloudflare Workers Migration Guide

## 🚀 Overview

This migration moves the AI Newsletter ingest pipeline from a local Node.js process to Cloudflare Workers + Queues for 24/7 operation without maintaining your own infrastructure.

## 📊 Architecture Comparison

### Before (Local Node.js)
- **Runtime**: ~3-7 hours for 1249 items
- **Compute**: Your local machine (must stay awake)
- **Storage**: Cloudflare R2
- **Cost**: Free (but requires your computer to run)
- **Scalability**: Limited by your machine

### After (Workers + Queues)
- **Runtime**: ~1-2 hours (distributed parallel processing)
- **Compute**: Cloudflare edge (always available)
- **Storage**: Cloudflare R2 (same as before)
- **Cost**: 
  - Workers: $5/month (10M requests included)
  - Queues: $0.40/M messages (first 5M free)
  - KV: $5/month (1GB storage, 10M reads free)
  - **Estimated**: $5-10/month for typical usage
- **Scalability**: Automatic, up to thousands of concurrent operations

## 📁 New Structure

```
src/worker/
├── index.ts                          # Main Worker entry point
├── handlers/
│   ├── scheduled.ts                  # Stage 1: Fetch feeds
│   ├── scrape.ts                     # Stage 2: Scrape URLs
│   ├── evaluate.ts                   # Stage 3: Evaluate relevance
│   └── upload.ts                     # Stage 4: Upload to R2
└── lib/
    ├── feeds-bundler.ts              # Bundled feeds.json
    ├── logger.ts                     # Worker logger adapter
    ├── kv-storage.ts                 # KV storage adapter
    └── config.ts                     # Worker configuration
```

## 🛠️ Setup Instructions

### 1. Install Dependencies

```bash
npm install -g wrangler
npm install --save-dev wrangler @cloudflare/workers-types
```

### 2. Run Setup Script

```bash
npm run worker:setup
```

This will:
- Authenticate with Cloudflare
- Create KV namespace
- Create queues (scrape, evaluate, upload)
- Set secrets from your .env file
- Deploy to dev environment

### 3. Manual Setup (if needed)

```bash
# Create KV namespace
wrangler kv:namespace create INGEST_STATE

# Create queues
wrangler queues create scrape-queue
wrangler queues create evaluate-queue
wrangler queues create upload-queue

# Set secrets
wrangler secret put FIRECRAWL_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put MISTRAL_API_KEY
wrangler secret put MOONSHOT_API_KEY
wrangler secret put REDDIT_CLIENT_ID  # optional
wrangler secret put REDDIT_CLIENT_SECRET  # optional

# Update wrangler.toml with your KV namespace ID
```

## 🚀 Deployment

### Development

```bash
# Start local dev server
npm run worker:dev

# Test manually (in another terminal)
npm run worker:trigger

# Watch logs
npm run worker:tail
```

### Production

```bash
# Deploy to production
npm run worker:deploy:prod
```

## 📈 Monitoring

### View Logs
```bash
# Real-time logs
wrangler tail --env production

# Or in the Cloudflare dashboard
```

### Check Ingest Status
```bash
# Using the API
curl https://your-worker.your-subdomain.workers.dev/health

# Or check KV storage in dashboard
```

## 🔧 Available Scripts

```bash
# Development
npm run worker:dev          # Start dev server
npm run worker:test         # Run local test
npm run worker:trigger      # Trigger manual ingest
npm run worker:tail         # Watch logs

# Deployment
npm run worker:setup        # Initial setup
npm run worker:deploy:dev   # Deploy to dev
npm run worker:deploy:prod  # Deploy to production
```

## 🔄 Queue Flow

1. **Scheduled Trigger** (every 6 hours)
   → `scheduled.ts` fetches feeds
   → Enqueues to `scrape-queue`

2. **Scrape Queue**
   → `scrape.ts` scrapes URLs via Firecrawl
   → Enqueues to `evaluate-queue`

3. **Evaluate Queue**
   → `evaluate.ts` checks relevance
   → Extracts external sources
   → Enqueues to `upload-queue`

4. **Upload Queue**
   → `upload.ts` stores content in R2
   → Updates KV for deduplication

## 💰 Cost Estimation

Based on 1249 items per run, 4 runs/day (every 6 hours):

- **Queue Messages**: ~10,000/day = 300,000/month ≈ **$0.12/month**
- **Worker Requests**: ~5,000/day = 150,000/month ≈ **$0** (within free tier)
- **KV Reads**: ~10,000/day = 300,000/month ≈ **$0** (within free tier)
- **KV Writes**: ~5,000/day = 150,000/month ≈ **$0** (within free tier)
- **KV Storage**: ~100MB ≈ **$0** (within free tier)

**Total: ~$5-10/month** (mainly Workers plan + some queue usage)

## ⚠️ Important Notes

### Current Limitations
1. **Feed fetching**: Still uses Node.js in scheduled.ts - needs to be fully refactored for Workers fetch API
2. **Existing code imports**: Some ingestion modules may need additional polyfills
3. **Error handling**: Queue retries are automatic, but dead-letter queues are not configured

### Next Steps
1. Test in dev environment thoroughly
2. Set up alerts for failures
3. Consider adding a dashboard for monitoring
4. Add dead-letter queues for failed messages
5. Implement incremental ingests (process only new items since last run)

## 🔄 Rollback Plan

If you need to revert to local Node.js:
```bash
# Just run the original script
npm run ingest
```

The Node.js version remains fully functional and can run alongside the Worker version.
