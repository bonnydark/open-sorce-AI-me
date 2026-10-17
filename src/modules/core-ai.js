/**
 * GortGPT Core Inference — provider-independent model runtime adapter.
 *
 * This code is owned by the project. It speaks the OpenAI-compatible HTTP
 * protocol to a model server that the operator controls (for example llama.cpp
 * server running a GGUF model). It never falls back to a hosted AI provider.
 *
 * Configure CORE_AI_URL to your own server URL, CORE_AI_MODEL to its model name,
 * and optionally CORE_AI_TOKEN as a Worker secret. The model weights/runtime
 * must be installed on infrastructure you control; they cannot be embedded in
 * a Cloudflare Worker bundle.
 */
function getEndpoint(env) {
  const raw = typeof env?.CORE_AI_URL === "string" ? env.CORE_AI_URL.trim() : "";
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { throw new Error("CORE_AI_URL must be a valid URL."); }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("CORE_AI_URL must use HTTPS outside localhost.");
  }
  const path = url.pathname.replace(/\/$/, "");
  if (/\/v1\/chat\/completions$/.test(path)) return url;
  url.pathname = (path.endsWith("/v1") ? path : path + "/v1") + "/chat/completions";
  return url;
}

export async function coreChat(env, messages, options = {}) {
  const endpoint = getEndpoint(env);
  // Prefer an explicitly configured self-hosted Core endpoint. If it is absent,
  // use Cloudflare Workers AI through the native binding; no API token is needed.
  if (!endpoint) {
    if (!env?.AI || typeof env.AI.run !== "function") {
      throw new Error("GortGPT AI is not configured. Enable the Workers AI binding (AI) for this Worker, or set CORE_AI_URL to your own HTTPS /v1 endpoint.");
    }
    const configuredModel = typeof env.CORE_AI_MODEL === "string" ? env.CORE_AI_MODEL.trim() : "";
    // Cloudflare retired the older Llama 3.1 model IDs. Override stale values
    // (including the historical "infire" typo) with a currently recommended model.
    const retiredModel = /(?:infire-)?llama-3\.1-8b-instruct(?:-awq)?$/i.test(configuredModel)
      || /@cf\/meta\/llama-3-8b-instruct(?:-awq)?$/i.test(configuredModel);
    const model = configuredModel && configuredModel !== "local-model" && !retiredModel
      ? configuredModel
      : "@cf/zai-org/glm-4.7-flash";
    const result = await env.AI.run(model, {
      messages: Array.isArray(messages) ? messages : [],
      temperature: Number.isFinite(options.temperature) ? options.temperature : 0.4,
      max_tokens: Number.isFinite(options.max_tokens) ? Math.min(options.max_tokens, 4096) : 1024
    });
    const answer = result?.response ?? result?.choices?.[0]?.message?.content ?? result?.output_text;
    if (typeof answer !== "string" || !answer.trim()) {
      throw new Error("Cloudflare Workers AI returned an empty response. Check the configured model and Workers AI availability.");
    }
    return answer.trim();
  }
  const headers = { "content-type": "application/json", "accept": "application/json" };
  const token = typeof env.CORE_AI_TOKEN === "string" ? env.CORE_AI_TOKEN.trim() : "";
  if (token) headers.authorization = "Bearer " + token;
  const model = typeof env.CORE_AI_MODEL === "string" && env.CORE_AI_MODEL.trim()
    ? env.CORE_AI_MODEL.trim() : "local-model";
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: Number.isFinite(options.temperature) ? options.temperature : 0.4,
      max_tokens: Number.isFinite(options.max_tokens) ? options.max_tokens : 2048,
      stream: false
    }),
    signal: AbortSignal.timeout(Math.min(Math.max(options.timeoutMs || 90000, 1000), 120000))
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 180);
    throw new Error("Self-hosted Core AI server returned HTTP " + response.status + (detail ? ": " + detail : ""));
  }
  const data = await response.json();
  const answer = data?.choices?.[0]?.message?.content ?? data?.response ?? data?.output_text;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("Self-hosted Core AI server returned an empty response.");
  return answer.trim();
}

export function toMultimodalMessages(messages, images) {
  const valid = Array.isArray(images) ? images.filter(x => typeof x === "string" && /^data:image\/(png|jpeg|webp|gif|bmp|avif);base64,/i.test(x)).slice(0, 3) : [];
  if (!valid.length) return messages;
  const result = Array.isArray(messages) ? messages.map(x => ({ ...x })) : [];
  let index = -1;
  for (let i = result.length - 1; i >= 0; i--) if (result[i].role === "user") { index = i; break; }
  if (index < 0) result.push({ role: "user", content: [{ type: "text", text: "Please analyze the attached image(s)." }, ...valid.map(url => ({ type: "image_url", image_url: { url } }))] });
  else {
    const original = typeof result[index].content === "string" ? result[index].content : "";
    result[index].content = [{ type: "text", text: original || "Analyze the attached image(s), answering in the user's language." }, ...valid.map(url => ({ type: "image_url", image_url: { url } }))];
  }
  return result;
}
