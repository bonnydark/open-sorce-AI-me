#!/usr/bin/env bash
set -euo pipefail

echo "==> Applying pending D1 migrations to production..."
npx wrangler d1 migrations apply open-sorce-ai-me-db --remote

echo "==> Deploying main GortGPT Worker and static assets..."
npx wrangler deploy

echo "==> Deploying standalone browser-local AI Worker..."
npx wrangler deploy --config wrangler.local-ai.toml

echo "==> Both GortGPT deployment steps completed."
