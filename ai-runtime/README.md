# GortGPT Core AI — self-hosted runtime

This project owns the chat engine, module prompts, memory, routing, and API adapter. Model inference runs on a machine you control using llama.cpp; the application does not fall back to OpenAI, Cloudflare Workers AI, or another hosted inference provider.

## 1. Start a local model server

Install Docker and place a compatible GGUF instruct model in `ai-runtime/models/model.gguf`. Choose a model whose license permits your use and whose size fits your RAM/VRAM. The model file is not committed to Git because it can be multiple gigabytes.

From the repository root:

```bash
docker compose -f ai-runtime/compose.yml up -d
```

The local endpoint is `http://127.0.0.1:8080/v1`. Test it:

```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"local-model","messages":[{"role":"user","content":"Reply with: Core AI online"}],"stream":false}'
```

This is for local development. The Cloudflare Worker cannot reach your computer's localhost. For production, run the model server on a machine/VPS you control and expose it only through HTTPS with authentication and network restrictions. Set the Worker variables/secrets below to that private endpoint. Do not expose an unauthenticated inference server to the public internet.

## 2. Configure the Worker

In Cloudflare Workers > `openai` > Settings > Variables and Secrets, configure:

- `CORE_AI_URL`: your own server's HTTPS base URL ending in `/v1` (the adapter appends `/chat/completions`).
- `CORE_AI_MODEL`: model identifier accepted by your server, commonly `local-model`.
- `CORE_AI_TOKEN`: optional bearer token if your inference gateway validates one.

For local testing only, run a local Worker with `CORE_AI_URL=http://127.0.0.1:8080/v1`. Never set that localhost URL on the production Worker.

The health endpoint `GET /api/health` reports `ai: true` when `CORE_AI_URL` is configured; it does not guarantee the model server is reachable. Send a real test prompt after configuration.

## 3. Vision

Image analysis uses the OpenAI-compatible multimodal message format. To analyze images, choose a local vision model supported by your runtime and install its required projector/vision files as documented by that model. A text-only GGUF model cannot interpret images just because the web app accepts image attachments.

## 4. Hardware and costs

This removes per-request hosted AI provider quotas, but it does not make inference resource-free. You provide the machine, electricity/hosting, storage, bandwidth, and enough RAM/VRAM for the chosen model. Small quantized models can run on consumer hardware; larger models need substantially more memory. Start with a model sized for your hardware.

## Architecture

- `src/modules/core-ai.js`: provider-independent API adapter, no provider fallback.
- `src/modules/ai-engine.js`: core chat and multimodal vision orchestration.
- `src/modules/code-copilot.js`, `specialists.js`, `agent.js`, `gort.js`: independent task prompts routed through Core AI.
- Cloudflare Worker and D1 remain the web/API and database hosting layer; model inference is performed by the self-hosted runtime.
