#!/usr/bin/env bash
set -euo pipefail

echo "==> Applying pending D1 migrations to production..."
npx wrangler d1 migrations apply open-sorce-ai-me-db --remote

echo "==> Deploying Worker and static assets..."
npx wrangler deploy

echo "==> Deploy command completed."
