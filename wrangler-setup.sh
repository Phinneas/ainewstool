#!/bin/bash

# Cloudflare Workers Setup Script
# This script sets up the Workers project and deploys it
# Updated to be compatible with macOS (BSD tools)

set -e

echo "🚀 Setting up Cloudflare Workers for AI Newsletter Ingest..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "Installing wrangler..."
    npm install -g wrangler
fi

# Login to Cloudflare
echo "Please login to Cloudflare..."
wrangler login

# Create KV namespace
echo "Creating KV namespace..."
KV_OUTPUT=$(wrangler kv namespace create "INGEST_STATE" 2>&1)
echo "$KV_OUTPUT"

# Extract namespace ID (works with BSD sed/grep)
KV_NAMESPACE_ID=$(echo "$KV_OUTPUT" | sed -n 's/.*id = "\(.*\)".*/\1/p')

if [ -z "$KV_NAMESPACE_ID" ]; then
    echo "⚠️  Could not extract KV namespace ID from output"
    echo "Please manually update wrangler.toml with the KV namespace ID"
    echo "You can find it in the Cloudflare dashboard or in the output above"
else
    echo "✅ KV Namespace ID: $KV_NAMESPACE_ID"
    
    # Update wrangler.toml with sed (cross-platform compatible)
    # Create backup first
    cp wrangler.toml wrangler.toml.backup
    
    # Replace the placeholder with actual ID
    sed -i.bak "s/id = \"your_kv_namespace_id\"/id = \"$KV_NAMESPACE_ID\"/g" wrangler.toml
    rm -f wrangler.toml.bak
    
    echo "✅ Updated wrangler.toml with KV namespace ID"
fi

# Create queues
echo "Creating queues..."
echo "Creating scrape-queue..."
wrangler queues create scrape-queue || echo "Queue may already exist, continuing..."

echo "Creating evaluate-queue..."
wrangler queues create evaluate-queue || echo "Queue may already exist, continuing..."

echo "Creating upload-queue..."
wrangler queues create upload-queue || echo "Queue may already exist, continuing..."

# Set secrets from .env file
if [ -f ".env" ]; then
    echo "Setting secrets from .env file..."
    
    # Read each line and set as secret
    while IFS='=' read -r key value; do
        # Skip empty lines and comments
        key=$(echo "$key" | xargs) # trim whitespace
        value=$(echo "$value" | xargs | sed 's/^"//;s/"$//') # trim whitespace and quotes
        
        if [ -n "$key" ] && [ "$key" != "#"* ] && [ -n "$value" ]; then
            # Remove the 'export ' prefix if present
            key="${key#export }"
            
            # Skip common non-secret variables
            if [[ "$key" != "S3_ENDPOINT" && "$key" != "S3_BUCKET" && "$key" != "S3_REGION" && "$key" != "GHOST_API_URL" ]]; then
                echo "Setting secret: $key"
                echo "$value" | wrangler secret put "$key" || echo "⚠️  Failed to set $key, continuing..."
            fi
        fi
    done < .env
else
    echo "⚠️  No .env file found. Please set secrets manually:"
    echo "   wrangler secret put FIRECRAWL_API_KEY"
    echo "   wrangler secret put ANTHROPIC_API_KEY"
    echo "   wrangler secret put MISTRAL_API_KEY"
    echo "   wrangler secret put MOONSHOT_API_KEY"
fi

# Build the project
echo "Building project..."
npm run build

# Deploy to dev environment first
echo "Deploying to dev environment..."
wrangler deploy --env dev

# Test the deployment
echo "Testing deployment..."
WORKER_OUTPUT=$(wrangler info --env dev 2>&1)
WORKER_URL=$(echo "$WORKER_OUTPUT" | sed -n 's/.*URL: \(.*\)/\1/p')

if [ -n "$WORKER_URL" ]; then
    echo "✅ Worker deployed to: $WORKER_URL"
    echo "Testing health endpoint..."
    curl -f "$WORKER_URL/health" || echo "⚠️  Health check failed (but deployment succeeded)"
else
    echo "⚠️  Could not extract Worker URL"
    echo "Please check the deployment manually"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo ""
if [ -n "$WORKER_URL" ]; then
    echo "1️⃣  Test the pipeline:"
    echo "   curl -X POST $WORKER_URL/trigger"
    echo ""
    echo "2️⃣  Monitor logs:"
    echo "   wrangler tail --env dev"
    echo ""
    echo "3️⃣  Check health:"
    echo "   curl $WORKER_URL/health"
    echo ""
    echo "4️⃣  Deploy to production:"
    echo "   wrangler deploy --env production"
else
    echo "1️⃣  Find your Worker URL in the Cloudflare dashboard"
    echo ""
    echo "2️⃣  Test manually once you have the URL"
    echo ""
    echo "3️⃣  Deploy to production when ready"
fi

echo ""
echo "📖 The ingest will run automatically every 6 hours (cron: 0 */6 * * *)"
echo "📖 See WORKER_DEPLOY_CHECKLIST.md for production deployment steps"
echo "📖 See MIGRATION_SUMMARY.md for complete overview"
