export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return Response.json({ ok: true, service: "open-source-ai-me", ai: Boolean(env.AI) });
    }
    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
      }
      if (!env.AI) {
        return Response.json({ error: "Cloudflare Workers AI binding is missing. Check wrangler.toml." }, { status: 503 });
      }
      let body;
      try { body = await request.json(); }
      catch { return Response.json({ error: "Expected a JSON request body." }, { status: 400 }); }
      const message = typeof body?.message === "string" ? body.message.trim() : "";
      if (!message) return Response.json({ error: "Message is required." }, { status: 400 });
      if (message.length > 20000) return Response.json({ error: "Message is too long (20,000 characters max)." }, { status: 413 });

      try {
        const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: [
            {
              role: "system",
              content: "You are Open Source AI, a direct, capable assistant. Be clear, practical, and non-preachy. Help with programming, research, writing, analysis, and creative tasks. Be honest about uncertainty. Do not assist with instructions that would meaningfully enable serious harm."
            },
            { role: "user", content: message }
          ],
          max_tokens: 1800
        });
        const reply = result?.response ?? result?.choices?.[0]?.message?.content;
        if (typeof reply !== "string" || !reply.trim()) {
          return Response.json({ error: "The model returned an empty response." }, { status: 502 });
        }
        return Response.json({ reply });
      } catch (error) {
        return Response.json({ error: "Model request failed: " + String(error?.message ?? error).slice(0, 240) }, { status: 502 });
      }
    }
    return env.ASSETS.fetch(request);
  }
};
