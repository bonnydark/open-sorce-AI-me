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
  // Google News RSS is public and does not require an API key.
  const endpoint = new URL("https://news.google.com/rss/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("hl", "vi");
  endpoint.searchParams.set("gl", "VN");
  endpoint.searchParams.set("ceid", "VN:vi");
  const upstream = await fetch(endpoint, {
    headers: { "Accept": "application/rss+xml, application/xml, text/xml", "User-Agent": "OpenSourceAIme/1.0" },
    signal: AbortSignal.timeout(10000)
  });
  if (!upstream.ok) throw new Error("News provider request failed (HTTP " + upstream.status + ").");
  const xml = await upstream.text();
  const decode = value => String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
  const tag = (block, name) => {
    const match = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">", "i"));
    return match ? decode(match[1]) : "";
  };
  const results = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const title = tag(item, "title");
    const url = tag(item, "link");
    const pubDate = tag(item, "pubDate");
    const source = tag(item, "source");
    if (!title || !url) continue;
    try {
      if (!["https:", "http:"].includes(new URL(url).protocol)) continue;
    } catch { continue; }
    results.push({
      title: title.slice(0, 300),
      url,
      description: source ? "Source: " + source : "Recent news result",
      age: pubDate ? new Date(pubDate).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : ""
    });
    if (results.length >= 8) break;
  }
  return results;
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
    return json({ query, type, results, provider: type === "news" ? "Google News RSS" : "Brave Search", retrievedAt: new Date().toISOString() });
  } catch (error) { return json({ error: String(error?.message || error) }, 502); }
}
