#!/usr/bin/env bash
set -euo pipefail

echo "==> GortGPT deploy script: protect-main-worker-2026-10-17"
echo "==> Source revision: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "==> Applying pending D1 migrations to production..."
npx wrangler d1 migrations apply open-sorce-ai-me-db --remote

echo "==> Deploying main GortGPT Worker and static assets..."
npx wrangler deploy

echo "==> Main GortGPT deployment completed."
echo "==> Browser-local AI must be deployed from a separate Cloudflare Workers Builds project."
echo "==> Skipping wrangler.local-ai.toml here to avoid CI overriding its name to 'openai'."
