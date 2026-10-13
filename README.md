# Open Source AI Me

A modular AI workspace with a dedicated chat engine and a training-data preparation module.

## Repository layout

- `web/` — responsive chat UI.
- `src/index.js` — Cloudflare Worker API; serves `POST /api/chat` and calls Cloudflare Workers AI.
- `wrangler.toml` — Worker assets and Workers AI binding.
- `source/loader.js` — loads the module declared by the manifest.
- `source/manifest.json` — selects the active frontend module.
- `modul/ai-engine.js` — chat adapter with short-lived in-memory conversation context.
- `modul/assistant.js` — earlier assistant adapter retained for compatibility.
- `modul/training-lab.js` — stores and reviews prompt/answer examples and imports/exports JSONL for a separate fine-tuning runtime.

## AI engine

The active module is selected by `source/manifest.json`. It currently points to `modul/ai-engine.js`. The browser module sends chat messages to the same-origin `/api/chat` endpoint. The Worker calls the configured Cloudflare Workers AI model. Provider secrets must never be placed in frontend files or committed to Git.

The chat module's memory is temporary and exists in the running browser session. It is not model training and is not a persistent cross-device memory.

## Training Lab

`modul/training-lab.js` is a data-preparation module, not a model trainer. It supports reviewed examples, dataset validation, and JSONL import/export. Examples are stored in that browser's local storage, so they are not automatically shared with other devices. A compatible training runtime is still needed to fine-tune model weights; Cloudflare Workers do not train a large model just by loading this JavaScript module.

## Deploy

This repository includes a GitHub Actions workflow that runs `wrangler deploy` on pushes to `main`. Configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository Actions secrets. Never paste secret values into chat or commit them to the repository.

To test the Worker health endpoint, open `/api/health` on the deployed site. It reports whether the Workers AI binding is present; it does not guarantee every model invocation will succeed.
