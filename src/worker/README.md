# Cloudflare Workers Migration

This directory contains the Cloudflare Workers implementation for the AI Newsletter ingest pipeline.

## Quick Start

1. **Setup (First Time Only)**
   ```bash
   npm run worker:setup
   ```

2. **Run Locally**
   ```bash
   npm run worker:dev
   ```

3. **Trigger Ingest**
   ```bash
   npm run worker:trigger
   ```

4. **Watch Logs**
   ```bash
   npm run worker:tail
   ```

## Architecture

### Queue Flow

```
Scheduled (every 6h)
  ↓
scheduled.ts (fetch feeds)
  ↓
scrape-queue
  ↓
scrape.ts (Firecrawl)
  ↓
evaluate-queue
  ↓
evaluate.ts (LLM relevance check)
  ↓
upload-queue
  ↓
upload.ts (store in R2)
```

### Key Differences from Node.js Version

1. **State Management**: Uses KV instead of memory
2. **Error Handling**: Automatic retry via Queues
3. **Concurrency**: Handled by Cloudflare (more efficient)
4. **Timeouts**: 30s per message (automatic retry)

## Files

- `index.ts` - Main Worker entry point
- `handlers/` - Queue handlers for each stage
- `lib/` - Worker-specific adapters
- `test-manual.ts` - Local testing script

## Environment Variables

All secrets are set via `wrangler secret put`. See `wrangler.toml` for bindings.

## Performance

- **Scrape**: 10 concurrent (was 3)
- **Evaluate**: 20 concurrent (was 12)
- **Upload**: 30 concurrent (was 15)
- **Expected time**: ~1-2 hours for 1249 items
