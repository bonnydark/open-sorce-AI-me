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

      // Accept only a small, validated conversation window from the dedicated AI module.
      const supplied = Array.isArray(body?.messages) ? body.messages : [{ role: "user", content: message }];
      const conversation = supplied
        .filter(item =>
          item &&
          (item.role === "user" || item.role === "assistant") &&
          typeof item.content === "string" &&
          item.content.trim().length > 0
        )
        .slice(-12)
        .map(item => ({ role: item.role, content: item.content.slice(0, 20000) }));

      // Ensure the current prompt is included even if a malformed client omitted it.
      if (!conversation.length || conversation[conversation.length - 1].role !== "user" ||
          conversation[conversation.length - 1].content !== message) {
        conversation.push({ role: "user", content: message });
      }

      try {
        const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages: [
            {
              role: "system",
              content: "You are Open Source AI, an independent modular assistant. Be clear, practical, and helpful with programming, analysis, writing, and creative tasks. Use prior conversation for context. When writing code, use fenced code blocks and identify the language. Be honest about uncertainty and do not claim to have executed actions you have not performed. Do not assist with instructions that would meaningfully enable serious harm."
            },
            ...conversation
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
