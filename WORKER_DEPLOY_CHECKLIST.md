# 🚀 Worker Deployment Checklist

## Pre-Deployment

- [ ] Install wrangler: `npm install -g wrangler`
- [ ] Login to Cloudflare: `wrangler login`
- [ ] Copy `.env` to `.dev.vars` for local development
- [ ] Review `wrangler.toml` settings
- [ ] Test locally with: `npm run worker:dev`

## Infrastructure Setup

Run: `npm run worker:setup`

This will create:
- [ ] KV namespace (INGEST_STATE)
- [ ] Queue: scrape-queue
- [ ] Queue: evaluate-queue
- [ ] Queue: upload-queue
- [ ] Set all secrets from .env
- [ ] Deploy to dev environment

## Testing

- [ ] Start dev server: `npm run worker:dev`
- [ ] In another terminal, trigger: `npm run worker:trigger` or `curl -X POST http://localhost:8787/trigger`
- [ ] Watch logs: `npm run worker:tail`
- [ ] Check health: `curl http://localhost:8787/health`
- [ ] Verify items appear in R2 bucket
- [ ] Verify KV entries are created

## Production Deployment

- [ ] Deploy to prod: `npm run worker:deploy:prod`
- [ ] Set production secrets if needed
- [ ] Verify cron schedule in `wrangler.toml`
- [ ] Test production endpoint manually
- [ ] Verify logs: `wrangler tail --env production`

## Monitoring & Alerts

- [ ] Set up email alerts for failures
- [ ] Create dashboard (optional)
- [ ] Document run frequency and expected duration
- [ ] Set up Sentry or similar for error tracking

## Post-Deployment

- [ ] Disable or reduce frequency of local Node.js cron
- [ ] Monitor first few runs closely
- [ ] Check costs after 1 week
- [ ] Document any issues found

## Rollback Plan

If something goes wrong:

1. **Pause Worker**: `wrangler deploy --env production --var PAUSE_PIPELINE:true`
2. **Run Node.js version**: `npm run ingest`
3. **Debug Worker**: Check logs, fix issues
4. **Re-enable Worker**: Deploy fixed version

## Cost Monitoring

Check usage weekly:

```bash
# View usage in Cloudflare dashboard
# Or estimate based on logs
```

Expected: $5-10/month
Alert if: >$20/month
