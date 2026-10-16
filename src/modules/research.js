const json = (body, status = 200) => Response.json(body, { status });

export async function handleResearchSearch(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.BRAVE_SEARCH_API_KEY) return json({ error: "Live search is not configured. Add BRAVE_SEARCH_API_KEY as a Worker secret." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (query.length < 2) return json({ error: "Enter a search query." }, 400);
  if (query.length > 300) return json({ error: "Search query is too long." }, 413);

  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", "8");
  const upstream = await fetch(endpoint, {
    headers: {
      "Accept": "application/json",
      "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!upstream.ok) {
    const status = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
    return json({ error: status === 502 ? "Search provider rejected its API key or access plan." : "Search provider request failed." }, status);
  }
  const data = await upstream.json();
  const results = (data?.web?.results || []).slice(0, 8).map(item => ({
    title: String(item.title || "").slice(0, 300),
    url: String(item.url || ""),
    description: String(item.description || "").slice(0, 1200),
    age: String(item.age || item.page_age || "").slice(0, 80)
  })).filter(item => {
    try { return ["https:", "http:"].includes(new URL(item.url).protocol); } catch { return false; }
  });
  return json({ query, results, provider: "Brave Search", retrievedAt: new Date().toISOString() });
}
