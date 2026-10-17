# GortGPT MVP Completion Roadmap

## Product target
Build a maintainable AI workspace with account-scoped chats and memories, independent task modules, predictable daily limits, auditable credits, cost visibility, and a safe path to paid plans.

## Phase 1 — Metering and quotas
- [x] Every account receives 100 AI requests per UTC day (resets at 00:00 UTC / 07:00 Vietnam time).
- [x] Bonus credits are separate from the free daily allowance and are consumed only after the allowance is exhausted.
- [x] Record module, model label, input character count, image count, and optional estimated cost per successful AI request.
- [x] Admin dashboard can show estimated monthly cost overall and by account.
- [ ] Test reset boundary, zero credits, 1 credit remaining, concurrent requests, failed AI responses, and missing migrations against a staging D1 database.
- [ ] Verify the migration and Worker deployment in Cloudflare production.

## Cost accounting
The app does not currently receive reliable invoice-grade cost data from every inference path. Estimated costs therefore stay unconfigured until the owner supplies rates. In Cloudflare Worker Variables, optionally configure:
- `AI_ESTIMATED_COST_PER_REQUEST_USD`: estimated base cost for one AI request, as a non-negative decimal.
- `AI_ESTIMATED_COST_PER_IMAGE_USD`: additional estimated cost per attached image, as a non-negative decimal.

These are owner-provided estimates, not official provider billing data. Leave them unset rather than presenting a made-up $0 cost. Reconcile actual spend with provider invoices and infrastructure bills before setting product prices.

## Phase 2 — Independent inference and AI modules
- Keep General AI, Code Copilot, Security Analyst, Study Tutor, Vision AI, and Gort behind stable module interfaces with separate prompts/configuration.
- Keep model selection, timeouts, output limits, logging, and errors isolated by module.
- Add a self-hosted inference adapter and health check; make deployment mode explicit.
- Do not claim that inference is independent of outside infrastructure while a module uses the Cloudflare `AI` binding. Running model weights independently requires a machine with sufficient RAM/VRAM and an inference server; a Worker alone is not a GPU host.
- Test vision, long context, tool calls, refusal/guardrail behavior, and failure recovery against the actual selected models.

## Phase 3 — MVP quality gate
- Auth/session continuity, chat persistence, share/revoke, attachments and image analysis.
- Per-account memories can be inspected, edited, and deleted.
- Authorization checks for every private resource; admin endpoints fail closed.
- Automated smoke tests for key API routes, schema migrations, and mobile/desktop layouts.
- No secrets committed to Git; rotate any credential accidentally exposed in repository history.

## Phase 4 — UI/UX polish
Only after the MVP quality gate passes: simplify navigation, improve onboarding and empty states, accessibility/keyboard behavior, responsive layout, loading/error states, pricing page, and product landing page.

## Phase 5 — Launch and monetization
- Define a free tier and paid tiers from measured infrastructure cost and support capacity.
- Add payment webhook idempotency, subscription lifecycle tests, invoices/receipts, cancellation, and account entitlement checks.
- Publish privacy/data retention information, acceptable-use rules, status/support contact, and a clear refund/cancellation policy.
- Launch to a small beta cohort, track activation, weekly retention, cost per active user, conversion, and failure rate before spending on promotion.
- Promote only after privacy, billing, uptime, and support processes are ready.

## Release checklist
- [ ] Apply all pending D1 migrations using `bash deploy.sh` from the configured Cloudflare build environment.
- [ ] Confirm `/api/health` reports `ok`, `ai`, and `database` as expected.
- [ ] Sign in with a normal account and verify `/api/usage` shows 100 daily requests.
- [ ] Verify the admin pages work only for the account configured in `ADMIN_EMAIL`.
- [ ] Verify estimated cost is labeled as unconfigured until cost-rate variables are supplied.
- [ ] Run a real image-analysis test and a text-only test on the deployed Worker.
