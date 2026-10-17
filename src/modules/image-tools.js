const json = (data, status = 200) => Response.json(data, { status });

function getImageEndpoint(env) {
  const raw = typeof env.CORE_IMAGE_URL === "string" ? env.CORE_IMAGE_URL.trim() : "";
  if (!raw) throw new Error("Self-hosted image generation is not configured. Set CORE_IMAGE_URL to your own OpenAI-compatible /v1/images/generations endpoint.");
  let url;
  try { url = new URL(raw); } catch { throw new Error("CORE_IMAGE_URL must be a valid URL."); }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("CORE_IMAGE_URL must use HTTPS outside localhost.");
  let path = url.pathname;
  while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path.endsWith("/v1/images/generations")) {
    url.pathname = path;
    return url;
  }
  url.pathname = (path.endsWith("/v1") ? path : path + "/v1") + "/images/generations";
  return url;
}

export async function handleImageGeneration(request, env, user) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return json({ error: "Describe the image you want to create." }, 400);
  if (prompt.length > 1500) return json({ error: "Image prompt must be 1,500 characters or fewer." }, 413);
  try {
    const endpoint = getImageEndpoint(env);
    const headers = { "content-type": "application/json", "accept": "application/json" };
    if (typeof env.CORE_IMAGE_TOKEN === "string" && env.CORE_IMAGE_TOKEN.trim()) headers.authorization = "Bearer " + env.CORE_IMAGE_TOKEN.trim();
    const model = typeof env.CORE_IMAGE_MODEL === "string" && env.CORE_IMAGE_MODEL.trim() ? env.CORE_IMAGE_MODEL.trim() : "local-image-model";
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, prompt, n: 1, response_format: "b64_json" }),
      signal: AbortSignal.timeout(120000)
    });
    if (!upstream.ok) throw new Error("Self-hosted image server returned HTTP " + upstream.status + ": " + (await upstream.text().catch(() => "")).slice(0, 180));
    const result = await upstream.json();
    const item = result?.data?.[0] || result;
    let image = item?.b64_json || item?.image || item?.image_base64;
    let mimeType = item?.mime_type || "image/png";
    if (typeof image === "string" && image.startsWith("data:image/")) {
      const comma = image.indexOf(",");
      if (comma > 0 && image.slice(0, comma).includes(";base64")) {
        const declaredMime = image.slice(5, image.indexOf(";"));
        if (declaredMime.startsWith("image/")) mimeType = declaredMime;
        image = image.slice(comma + 1);
      }
    }
    if (typeof image !== "string" && typeof item?.url === "string") {
      const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(30000) });
      if (!imageResponse.ok) throw new Error("Image server returned an inaccessible image URL.");
      const buffer = await imageResponse.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      image = btoa(binary);
      mimeType = imageResponse.headers.get("content-type") || "image/png";
    }
    if (typeof image !== "string" || !image.length) throw new Error("Self-hosted image server returned no base64 image or image URL.");
    return json({ ok: true, mimeType, image: image.startsWith("data:") ? image : "data:" + mimeType + ";base64," + image, prompt, model });
  } catch (error) {
    return json({ error: "Image generation failed: " + String(error?.message || error).slice(0, 300) }, 502);
  }
}
