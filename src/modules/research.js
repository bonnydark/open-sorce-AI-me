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

async function fetchNewsRss(url, provider) {
  const upstream = await fetch(url, {
    headers: { "Accept": "application/rss+xml, application/xml, text/xml, */*", "User-Agent": "Mozilla/5.0 (compatible; OpenSourceAIme/1.0)" },
    signal: AbortSignal.timeout(9000)
  });
  if (!upstream.ok) throw new Error(provider + " HTTP " + upstream.status);
  const xml = await upstream.text();
  const decode = (value) => value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  const tag = (item, name) => {
    const match = item.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
    return match ? decode(match[1].trim()) : "";
  };
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, 8);
  return items.map(match => {
    const item = match[1];
    const url = tag(item, "link");
    try { if (!["https:", "http:"].includes(new URL(url).protocol)) return null; } catch { return null; }
    const title = tag(item, "title");
    const date = tag(item, "pubDate");
    let age = "";
    if (date) {
      const parsed = new Date(date);
      if (!Number.isNaN(parsed.getTime())) age = parsed.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    }
    let domain = "";
    try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch {}
    return { title: title.slice(0, 300) || domain || url, url, description: domain ? "Source: " + domain : "News result", age };
  }).filter(Boolean);
}

export async function searchNews(env, query) {
  const attempts = [
    async () => {
      const endpoint = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
      endpoint.searchParams.set("query", query);
      endpoint.searchParams.set("mode", "ArtList");
      endpoint.searchParams.set("format", "json");
      endpoint.searchParams.set("maxrecords", "8");
      endpoint.searchParams.set("sort", "DateDesc");
      const upstream = await fetch(endpoint, {
        headers: { "Accept": "application/json", "User-Agent": "OpenSourceAIme/1.0" },
        signal: AbortSignal.timeout(9000)
      });
      if (!upstream.ok) throw new Error("GDELT HTTP " + upstream.status);
      const data = await upstream.json();
      const results = (Array.isArray(data?.articles) ? data.articles : []).slice(0, 8).map(item => {
        const url = String(item.url || "");
        try { if (!["https:", "http:"].includes(new URL(url).protocol)) return null; } catch { return null; }
        const domain = String(item.domain || "").trim();
        const date = String(item.seendate || "").trim();
        let age = "";
        if (date) {
          const parsed = new Date(date);
          if (!Number.isNaN(parsed.getTime())) age = parsed.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
        }
        return { title: String(item.title || "").trim().slice(0, 300) || domain || url, url, description: domain ? "Source: " + domain : "Recent news result", age };
      }).filter(Boolean);
      return { results, provider: "GDELT" };
    },
    async () => {
      const endpoint = new URL("https://www.bing.com/news/search");
      endpoint.searchParams.set("q", query);
      endpoint.searchParams.set("format", "rss");
      return { results: await fetchNewsRss(endpoint, "Bing News"), provider: "Bing News RSS" };
    },
    async () => {
      const endpoint = new URL("https://news.google.com/rss/search");
      endpoint.searchParams.set("q", query);
      endpoint.searchParams.set("hl", "en-US");
      endpoint.searchParams.set("gl", "US");
      endpoint.searchParams.set("ceid", "US:en");
      return { results: await fetchNewsRss(endpoint, "Google News"), provider: "Google News RSS" };
    }
  ];
  const failures = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result.results.length) return result;
      failures.push("no results");
    } catch (error) {
      failures.push(String(error?.message || error));
    }
  }
  throw new Error("All news providers are temporarily unavailable. " + failures.join("; "));
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
    const result = type === "news" ? await searchNews(env, query) : { results: await searchWeb(env, query), provider: "Brave Search" };
    return json({ query, type, results: result.results, provider: result.provider, retrievedAt: new Date().toISOString() });
  } catch (error) { return json({ error: String(error?.message || error) }, 502); }
}
