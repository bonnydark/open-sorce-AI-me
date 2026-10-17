# GortGPT Local AI (browser inference)

This is a separate static browser app. It uses WebLLM/WebGPU to download a compatible open model into the browser cache and execute inference on the visitor's device. The Cloudflare Worker serves the app; it does **not** run the language model.

## Deploy separately

From the repository root, deploy the additional Worker:

```bash
npx wrangler deploy --config wrangler.local-ai.toml
```

Cloudflare will publish the Worker at its workers.dev address, normally based on the Worker name: `https://gortgpt-local-ai.<your-workers-subdomain>.workers.dev/`. The account's workers.dev subdomain must be enabled, and the actual hostname depends on the account.

## How it works

- App code is in `web/local-ai/`; Worker entry is `src/local-ai-worker.js`.
- WebLLM and model artifacts are downloaded by the browser from the library/model CDN. They are not committed into this repository.
- Inference runs locally using WebGPU. A supported browser, graphics driver, sufficient memory, and a first-time download are required.
- Chat prompts are not sent to the GortGPT backend by this page for inference. Network requests still occur to load the JavaScript package and model files.
- This prototype does not yet connect to GortGPT account history, tools, image input, or the main app's server-side chat API.
- Verify the chosen model's current availability and license before commercial use. Browser model identifiers and WebGPU compatibility may change as the library evolves.

## Deployment note

The existing `deploy.sh` deploys the main Worker only. Deploy this second Worker as a separate Cloudflare Pages/Workers build or run the command above. Do not put multi-gigabyte model weights in GitHub or the Worker bundle.
