const json = (data, status = 200) => Response.json(data, { status });

export async function handleImageGeneration(request, env, user) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.AI) return json({ error: "Cloudflare Workers AI binding is not configured." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return json({ error: "Describe the image you want to create." }, 400);
  if (prompt.length > 1500) return json({ error: "Image prompt must be 1,500 characters or fewer." }, 413);
  try {
    const result = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt });
    let image = result?.image;
    if (image instanceof ArrayBuffer) image = btoa(String.fromCharCode(...new Uint8Array(image)));
    else if (image instanceof Uint8Array) {
      let binary = "";
      for (let i = 0; i < image.length; i += 0x8000) binary += String.fromCharCode(...image.subarray(i, i + 0x8000));
      image = btoa(binary);
    }
    if (typeof image !== "string" || !image.length) {
      return json({ error: "The image model returned no image. Please try a more specific prompt." }, 502);
    }
    // Workers AI returns the generated image as base64. Do not store it automatically;
    // the client can explicitly save it to the user's private file area.
    return json({ ok: true, mimeType: "image/png", image: "data:image/png;base64," + image, prompt, model: "@cf/black-forest-labs/flux-1-schnell" });
  } catch (error) {
    return json({ error: "Image generation failed: " + String(error?.message || error).slice(0, 300) }, 502);
  }
}
