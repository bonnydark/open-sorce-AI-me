# GortGPT

A modular AI chat workspace built with a static frontend and a Cloudflare Worker backend.

## Features
- Email registration and sign-in.
- Passwords are salted and hashed with PBKDF2 on the Worker.
- HttpOnly, Secure, SameSite session cookie with server-side session records.
- Per-account chat history stored in Cloudflare D1.
- Safe OSINT workspace for passive public-source research on public domains and public IPs: RDAP, certificate transparency, DNS, urlscan.io, VirusTotal, indexed pages, public code references, and archived snapshots. It opens external source pages; it does not run scans or automatically validate findings.
- Conversation links use `/{username}/c-{opaque-conversation-id}` without putting chat titles in the URL; the backend still checks account ownership.
- Personalized welcome screen and shareable/deep-linkable conversation paths.
- Per-account preferences: theme, response style, typewriter effect/speed, and code panels.
- SaaS usage metering records request counts, input character counts, image counts, and module usage without storing prompt/response content in the usage table.
- Dedicated backend model adapter at `src/modules/ai-engine.js`; browser adapter at `modul/ai-engine.js`.
- Core chat, Code Copilot, Security Analyst, Study Tutor, Gort, and agent planning use the project-owned `src/modules/core-ai.js` adapter. Inference is sent only to a model server you control via `CORE_AI_URL`; there is no hosted AI-provider fallback. Model weights are installed on your own machine/server, not committed to Git.

## Project structure
- `web/index.html` — frontend, account UI, chat navigation, settings panel.
- `src/index.js` — Worker API router.
- `src/modules/auth.js` — account, password hashing, and session logic.
- `src/modules/user-settings.js` — per-user settings API.
- `src/modules/chat-store.js` — account-scoped conversation persistence.
- `src/modules/ai-engine.js` — backend inference module.
- `modul/ai-engine.js` — browser adapter that calls the backend.
- `migrations/0001_auth_chat.sql` — accounts, sessions, and chat history schema.
- `migrations/0002_user_settings.sql` — per-user preferences.
- `migrations/0005_usage_events.sql` — privacy-conscious usage metering.
- `wrangler.toml` — Worker, static Assets, and D1 binding. Model inference is self-hosted and configured separately.

## Required D1 setup
Create/configure the D1 database and bind it as `DB`. For self-hosted model setup, follow [`ai-runtime/README.md`](ai-runtime/README.md). Configure `CORE_AI_URL`, `CORE_AI_MODEL`, and optional `CORE_AI_TOKEN` in Worker variables/secrets. Image generation is a separate optional service configured with `CORE_IMAGE_URL`, `CORE_IMAGE_MODEL`, and optional `CORE_IMAGE_TOKEN`.

After applying the migrations, `GET /api/health` reports whether the Core AI endpoint is configured and the database is bound. This does not verify that the model server is reachable; send a test prompt.

## API
- `POST /api/auth/register` — `{ "name": "Name", "email": "you@example.com", "password": "at-least-8-chars" }`
- `POST /api/auth/login` — `{ "email": "you@example.com", "password": "..." }`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/settings` and `PUT /api/settings`
- `GET /api/usage` — authenticated usage summary for the last 30 days.
- `GET /api/chats`
- `POST /api/chats` — optional `{ "title": "New chat" }`
- `GET /api/chats/:id`
- `DELETE /api/chats/:id`
- `POST /api/chat` — `{ "message": "...", "conversationId": "optional-existing-chat-id" }`

All chat-history, settings, and AI endpoints require a signed-in session. Conversation IDs are checked against the authenticated account.

## Important notes
- Email verification and password reset are not implemented yet.
- Configure rate limiting at the edge before opening registration to the public.
- Chat titles stay in the account history rather than the URL. Conversation IDs are opaque identifiers, not encryption or authorization tokens; access is enforced by the authenticated backend.
- The application code and orchestration are project-owned, but the model weights are a separate dependency that you must download and run on infrastructure you control. This project does not yet train foundation-model weights from scratch.

## Specialist workspace modes

Settings includes an optional Specialist mode toggle with three focused profiles: Bug bounty / security researcher (authorized scope, safe verification, impact analysis and responsible disclosure), Developer support (debugging, code review, tests and secure defaults), and Student support (step-by-step explanations, examples and practice). The selected profile adjusts AI guidance and workspace accent/UI prompts and is stored with the signed-in user's settings.

The Support & report a bug form prepares a report locally and can copy it or open a prefilled GitHub issue draft. It does not submit the issue automatically. Do not put credentials, session cookies, private data, or sensitive undisclosed security details in public issues.


## Gort — standalone coding module

- Browser adapter: `modul/gort.js`; independent server engine and memory logic: `src/modules/gort.js`.
- Gort specializes in code generation, review, debugging, refactoring, and revision across programming languages. It preserves conversation context, uses configured live web research context, and uses the chat UI's existing browser-based voice input/output.
- Gort has a separate `gort_memories` table per account (`migrations/0006_gort_memories.sql`). With Automatic memories enabled, it stores explicit remember/preference statements; this is persistent memory, not model training or self-modifying weights.
- The numeric Caution / guardrail level is stored as `ethicsLevel` (0–100). It adjusts how cautious and explanatory the assistant is; it cannot disable core safety or privacy protections.
- All text, specialist, vision-message, and agent orchestration now route through `CORE_AI_URL`. Configure that endpoint to your own OpenAI-compatible runtime. Image generation separately requires your own compatible image-generation endpoint at `CORE_IMAGE_URL`. Cloudflare remains the web/API and D1 host only; it does not run the model. See [`ai-runtime/README.md`](ai-runtime/README.md).
