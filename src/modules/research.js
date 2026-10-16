const json = (body, status = 200) => Response.json(body, { status });

export async function searchWeb(env, query) {
  if (!env.BRAVE_SEARCH_API_KEY) throw new Error("Live search is not configured. Add BRAVE_SEARCH_API_KEY as a Worker secret.");
  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", "8");
  const upstream = await fetch(endpoint, { headers: { "Accept": "application/json", "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY }, signal: AbortSignal.timeout(10000) });
  if (!upstream.ok) throw new Error("Search provider request failed (HTTP " + upstream.status + ").");
  const data = await upstream.json();
  return (data?.web?.results || []).slice(0, 8).map(item => ({ title: String(item.title || "").slice(0, 300), url: String(item.url || ""), description: String(item.description || "").slice(0, 1200), age: String(item.age || item.page_age || "").slice(0, 80) })).filter(item => { try { return ["https:", "http:"].includes(new URL(item.url).protocol); } catch { return false; } });
}

export async function searchNews(env, query) {
  if (!env.BRAVE_SEARCH_API_KEY) throw new Error("Live search is not configured. Add BRAVE_SEARCH_API_KEY as a Worker secret.");
  const endpoint = new URL("https://api.search.brave.com/res/v1/news/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", "8");
  endpoint.searchParams.set("freshness", "pw");
  const upstream = await fetch(endpoint, { headers: { "Accept": "application/json", "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY }, signal: AbortSignal.timeout(10000) });
  if (!upstream.ok) throw new Error("News search provider request failed (HTTP " + upstream.status + ").");
  const data = await upstream.json();
  return (data?.results || []).slice(0, 8).map(item => ({ title: String(item.title || "").slice(0, 300), url: String(item.url || ""), description: String(item.description || "").slice(0, 1200), age: String(item.age || item.page_age || item.meta_url?.hostname || "").slice(0, 100) })).filter(item => { try { return ["https:", "http:"].includes(new URL(item.url).protocol); } catch { return false; } });
}

export async function handleResearchSearch(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const type = body?.type === "news" ? "news" : "web";
  if (query.length < 2) return json({ error: "Enter a search query." }, 400);
  if (query.length > 300) return json({ error: "Search query is too long." }, 413);
  try {
    const results = type === "news" ? await searchNews(env, query) : await searchWeb(env, query);
    return json({ query, type, results, provider: "Brave Search", retrievedAt: new Date().toISOString() });
  } catch (error) { return json({ error: String(error?.message || error) }, 502); }
}
