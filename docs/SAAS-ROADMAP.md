# Open Source AI Me — SaaS Roadmap

## Product direction

Build a modular AI workspace that can grow into a multi-user SaaS product. Keep the existing Cloudflare Workers + D1 foundation until measured usage justifies additional services. Do not market the product as having its own trained model: inference is provided by configured model providers.

## Product principles

- Privacy by default: usage analytics record counts and metadata, not prompt or completion contents.
- Tenant isolation: every private resource is scoped to the authenticated user or an explicitly authorized workspace.
- Modular inference: AI providers and specialist modules stay behind stable interfaces.
- Mobile-first usability and accessible controls.
- Cost controls before public launch: quotas, rate limiting, abuse monitoring, and clear user-facing limits.
- No paid billing until pricing, payment-provider setup, webhook verification, and refund/support processes are ready.

## Current foundation

- Email/password accounts and server-side sessions.
- Account-scoped conversations, settings, memories, files, and share links.
- Specialist AI modules and image input support (provider/model availability must be tested in production).
- Usage metadata endpoint: `GET /api/usage`, summarizing request counts, input character counts, image counts, and per-module usage over the last 30 days.
- Usage events intentionally do not store message contents.

## Delivery roadmap

### Phase 1 — Reliable core
- Verify production auth, refresh/session behavior, chat continuity, image uploads, and mobile navigation.
- Add automated smoke tests for health, auth, chat ownership, usage reporting, and migrations.
- Add structured error handling and request IDs without logging secrets or message content.
- Configure rate limits and sensible request/body limits before opening registration broadly.

### Phase 2 — SaaS readiness
- Add email verification and password reset with a verified email delivery provider.
- Add plan definitions and server-enforced quotas; never trust client-side plan labels.
- Build a usage/billing page that explains measured usage and current limits.
- Add account export and account deletion flows.
- Add operational monitoring, backups/restore checks, and documented incident handling.

### Phase 3 — Teams and workspaces
- Introduce workspaces, memberships, roles, and invitations.
- Add explicit ownership checks for every workspace resource.
- Keep personal workspaces as the default so existing accounts can be migrated safely.

### Phase 4 — Monetization
- Start with a free tier and one paid tier only after usage and inference costs are measured.
- Integrate a payment provider only after choosing the legal entity, supported country, tax handling, and payout setup.
- Verify billing webhooks server-side and store subscription state in the database.
- Enforce plan entitlements in the Worker, not in browser code.

### Phase 5 — Platform ecosystem
- Stable developer API with per-key scopes, rotation, revocation, and quotas.
- Provider/model routing, per-workspace controls, and transparent cost reporting.
- Audited agent workflows with explicit permissions and approval gates for external side effects.
- Optional integrations and a documented module SDK.

## Immediate next steps

1. Deploy and verify the usage migration and `GET /api/usage` in the Cloudflare environment.
2. Add a simple usage panel to Settings.
3. Add rate limiting and automated smoke tests before inviting external users.
4. Keep payment processing and team tenancy out of the first launch until the core is reliable.
