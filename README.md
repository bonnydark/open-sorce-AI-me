# Open Source AI Me

A modular AI chat workspace built with a static frontend and a Cloudflare Worker backend.

## Features
- Email registration and sign-in.
- Passwords are salted and hashed with PBKDF2 on the Worker.
- HttpOnly, Secure, SameSite session cookie with server-side session records.
- Per-account chat history stored in Cloudflare D1.
- Conversation links use `/{username}/c-{conversation-id}-{title-slug}`; the ID is URL-safe and the backend still checks account ownership.
- Personalized welcome screen and shareable/deep-linkable conversation paths.
- Per-account preferences: theme, response style, typewriter effect/speed, and code panels.
- Dedicated backend model adapter at `src/modules/ai-engine.js`; browser adapter at `modul/ai-engine.js`.
- Workers AI currently uses `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

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
- `wrangler.toml` — Worker, Assets, Workers AI, and D1 bindings.

## Required D1 setup
Create a Cloudflare D1 database named `open-sorce-ai-me-db`, copy its database ID into `wrangler.toml` in place of `REPLACE_WITH_YOUR_D1_DATABASE_ID`, then apply both migrations in order. The Worker needs a D1 binding named `DB` and a Workers AI binding named `AI`.

After applying the migrations, `GET /api/health` reports whether the Worker sees the AI and database bindings.

## API
- `POST /api/auth/register` — `{ "name": "Name", "email": "you@example.com", "password": "at-least-8-chars" }`
- `POST /api/auth/login` — `{ "email": "you@example.com", "password": "..." }`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/settings` and `PUT /api/settings`
- `GET /api/chats`
- `POST /api/chats` — optional `{ "title": "New chat" }`
- `GET /api/chats/:id`
- `DELETE /api/chats/:id`
- `POST /api/chat` — `{ "message": "...", "conversationId": "optional-existing-chat-id" }`

All chat-history, settings, and AI endpoints require a signed-in session. Conversation IDs are checked against the authenticated account.

## Important notes
- Email verification and password reset are not implemented yet.
- Configure rate limiting at the edge before opening registration to the public.
- Conversation title slugs in URLs are readable URL slugs, not encryption. The conversation ID is not a secret; authorization is enforced by the authenticated backend.
- The application code is open source, but inference currently depends on Cloudflare Workers AI; the repository does not itself contain model weights or a separately trained model.
