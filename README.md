# Open Source AI Me

A small modular AI web app with three main folders:

- `web/` — website UI
- `source/` — module loader and manifest
- `modul/` — AI modules

## Run locally

From the repository root, start any static server, for example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/web/`. The loader fetches `source/manifest.json` and the module code from this repository's `main` branch.

## Deploy as a website

The included GitHub Actions workflow publishes the contents of `web/` to GitHub Pages. Enable Pages in **Settings → Pages → Build and deployment → GitHub Actions** if it is not already enabled.

## Important

The starter module runs locally in the browser and is a demo assistant, not a trained foundation model. To connect a hosted AI model, add a backend/API proxy and keep API keys on the server—never put secret keys in browser code. Only load modules from repositories and versions you trust.