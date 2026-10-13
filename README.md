# Open Source AI Me

A modular AI chat workspace built with a static frontend and a Cloudflare Worker backend.

## Features
- Email registration and sign-in.
- Passwords are salted and hashed with PBKDF2 on the Worker.
- HttpOnly, Secure, SameSite session cookie with server-side session records.
- Per-account chat history stored in Cloudflare D1.
- Conversation ownership is checked on history, read, delete, and AI requests.
- Dedicated backend model adapter at `src/modules/ai-engine.js`.
- Browser-facing AI adapter at `modul/ai-engine.js`.
- Chat UI with history list, code blocks, and a typewriter effect.
- Workers AI currently uses `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

## Project structure
- `web/index.html` — frontend and account UI.
- `src/index.js` — Worker API router.
- `src/modules/auth.js` — account, password hashing, and session logic.
- `src/modules/chat-store.js` — account-scoped conversation persistence.
- `src/modules/ai-engine.js` — backend inference module.
- `modul/ai-engine.js` — browser adapter that calls the backend.
- `migrations/0001_auth_chat.sql` — D1 schema.
- `wrangler.toml` — Worker, Assets, Workers AI, and D1 bindings.

## Required D1 setup
Create a Cloudflare D1 database named `open-sorce-ai-me-db`, copy its database ID into `wrangler.toml` in place of `REPLACE_WITH_YOUR_D1_DATABASE_ID`, then apply the migration in `migrations/`. The Worker needs a D1 binding named `DB` and a Workers AI binding named `AI`.

After applying the migration, `GET /api/health` reports whether the Worker sees the AI and database bindings.

## API
- `POST /api/auth/register` — `{ "name": "Name", "email": "you@example.com", "password": "at-least-8-chars" }`
- `POST /api/auth/login` — `{ "email": "you@example.com", "password": "..." }`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/chats`
- `POST /api/chats` — optional `{ "title": "New chat" }`
- `GET /api/chats/:id`
- `DELETE /api/chats/:id`
- `POST /api/chat` — `{ "message": "...", "conversationId": "optional-existing-chat-id" }`

All chat-history and AI endpoints require a signed-in session. Messages are saved under the authenticated account and never selected by a user-supplied user ID.

## Important notes
- Email verification and password reset are not implemented yet.
- Configure rate limiting at the edge before opening registration to the public.
- The application code is open source, but inference currently depends on Cloudflare Workers AI; the repository does not itself contain model weights or a separately trained model.
