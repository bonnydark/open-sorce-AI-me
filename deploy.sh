#!/usr/bin/env bash
set -euo pipefail

echo "==> GortGPT deploy script: local-ai-rollout-2026-10-17"
echo "==> Source revision: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "==> Applying pending D1 migrations to production..."
npx wrangler d1 migrations apply open-sorce-ai-me-db --remote

echo "==> Deploying main GortGPT Worker and static assets..."
npx wrangler deploy

echo "==> Deploying standalone browser-local AI Worker..."
npx wrangler deploy --config wrangler.local-ai.toml

echo "==> Both GortGPT deployment steps completed."
