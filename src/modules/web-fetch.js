function isBlockedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "0.0.0.0" || host === "::" || host === "::1" || host === "127.0.0.1" || host.includes(":")) return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a=+m[1],b=+m[2],c=+m[3],d=+m[4];
    if ([a,b,c,d].some(n=>n>255)) return true;
    if (a===10 || a===127 || a===0 || a===169&&b===254 || a===172&&b>=16&&b<=31 || a===192&&b===168 || a>=224) return true;
  }
  return false;
}
function decodeEntities(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(0x10ffff, Number(n))))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(0x10ffff, parseInt(n, 16))));
}
function htmlToReadableText(source) {
  const title = (source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<[^>]*>/g, " ");
  const description = source.match(/<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1] || "";
  const body = source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|iframe|nav|footer|header|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|article|section|li|h[1-6]|tr|blockquote|main)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body).replace(/[\t\f\v ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return [title ? "Page title: " + decodeEntities(title).trim() : "", description ? "Page description: " + decodeEntities(description).trim() : "", text].filter(Boolean).join("\n\n").slice(0, 50000);
}
async function fetchGitHubRepository(url) {
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (url.hostname.toLowerCase() !== "github.com" || !match) return null;
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  if (owner.startsWith(".") || repo.startsWith(".")) return null;
  const headers = { "User-Agent": "OpenSourceAI-Me-WebReader/1.0", "Accept": "application/vnd.github+json" };
  const apiBase = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  const metadataResponse = await fetch(apiBase, { headers, signal: AbortSignal.timeout(8000) });
  if (!metadataResponse.ok) throw new Error("GitHub repository lookup returned HTTP " + metadataResponse.status + ".");
  const metadata = await metadataResponse.json();
  const parts = [
    "GitHub public repository: " + metadata.full_name,
    "Description: " + (metadata.description || "No description provided."),
    "Default branch: " + (metadata.default_branch || "unknown"),
    "Language: " + (metadata.language || "not specified"),
    "Stars: " + Number(metadata.stargazers_count || 0),
    "Last updated: " + (metadata.updated_at || "unknown"),
    "Repository URL: " + (metadata.html_url || url.toString()),
    "Topics: " + (Array.isArray(metadata.topics) && metadata.topics.length ? metadata.topics.join(", ") : "not listed")
  ];
  try {
    const readmeResponse = await fetch(apiBase + "/readme", { headers, signal: AbortSignal.timeout(8000) });
    if (readmeResponse.ok) {
      const readme = await readmeResponse.json();
      if (typeof readme.content === "string" && readme.encoding === "base64") {
        const binary = atob(readme.content.replace(/\s/g, ""));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        const decoded = new TextDecoder().decode(bytes).slice(0, 50000);
        parts.push("README file: " + (readme.path || "README") + "\nBEGIN README CONTENT\n" + decoded + "\nEND README CONTENT");
      }
    }
  } catch {}
  return { url: url.toString(), status: 200, contentType: "application/vnd.github.repository+text", text: parts.join("\n") };
}
export async function fetchPublicText(input, redirectCount = 0) {
  if (redirectCount > 2) throw new Error("Too many redirects; open the final public URL directly.");
  let url;
  try { url = new URL(input); } catch { throw new Error("Give a valid full URL, e.g. https://example.com or a raw GitHub URL."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP and HTTPS URLs are allowed.");
  if (url.username || url.password || isBlockedHost(url.hostname)) throw new Error("That host is blocked for safety.");
  if (url.port && !["80","443"].includes(url.port)) throw new Error("Only standard HTTP/HTTPS ports are allowed.");
  const githubRepository = await fetchGitHubRepository(url);
  if (githubRepository) return githubRepository;
  const response = await fetch(url.toString(), { method: "GET", redirect: "manual", headers: { "User-Agent": "OpenSourceAI-Me-WebReader/1.0", "Accept": "text/html,text/plain,application/json,application/javascript,text/css,*/*;q=0.2" }, signal: AbortSignal.timeout(8000) });
  if ([301,302,303,307,308].includes(response.status)) {
    const location = response.headers.get("Location");
    if (!location) throw new Error("Website redirected without a location.");
    const next = new URL(location, url);
    if (next.hostname !== url.hostname) throw new Error("Cross-host redirects are blocked. Open the final URL directly.");
    if (next.protocol !== "https:" && next.protocol !== "http:" || isBlockedHost(next.hostname)) throw new Error("Redirect target is blocked for safety.");
    return fetchPublicText(next.toString(), redirectCount + 1);
  }
  if (!response.ok) throw new Error("Website returned HTTP " + response.status + ".");
  const type = response.headers.get("content-type") || "unknown";
  if (!/(text\/|application\/(json|javascript|xml|xhtml\+xml))/.test(type)) throw new Error("This endpoint is not a text/HTML/JSON response (" + type + ").");
  const raw = (await response.text()).slice(0, 80000);
  const text = /html|xhtml/i.test(type) ? htmlToReadableText(raw) : raw.slice(0, 50000);
  return { url: url.toString(), status: response.status, contentType: type, text };
}