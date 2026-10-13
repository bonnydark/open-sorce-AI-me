function isBlockedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "0.0.0.0" || host === "::" || host === "::1" || host === "127.0.0.1") return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a=+m[1],b=+m[2],c=+m[3],d=+m[4];
    if ([a,b,c,d].some(n=>n>255)) return true;
    if (a===10 || a===127 || a===0 || a===169&&b===254 || a===172&&b>=16&&b<=31 || a===192&&b===168 || a>=224) return true;
  }
  return false;
}
export async function fetchPublicText(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error("Give a valid full URL, e.g. https://example.com or a raw GitHub URL."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP and HTTPS URLs are allowed.");
  if (url.username || url.password || isBlockedHost(url.hostname)) throw new Error("That host is blocked for safety.");
  if (url.port && !["80","443"].includes(url.port)) throw new Error("Only standard HTTP/HTTPS ports are allowed.");
  const response = await fetch(url.toString(), { method: "GET", redirect: "manual", headers: { "User-Agent": "OpenSourceAI-Me-WebReader/1.0", "Accept": "text/html,text/plain,application/json,application/javascript,text/css,*/*;q=0.2" }, signal: AbortSignal.timeout(8000) });
  if ([301,302,303,307,308].includes(response.status)) {
    const location = response.headers.get("Location");
    if (!location) throw new Error("Website redirected without a location.");
    const next = new URL(location, url);
    if (next.hostname !== url.hostname) throw new Error("Cross-host redirects are blocked. Open the final URL directly.");
    return fetchPublicText(next.toString());
  }
  if (!response.ok) throw new Error("Website returned HTTP " + response.status + ".");
  const type = response.headers.get("content-type") || "unknown";
  if (!/(text\/|application\/(json|javascript|xml|xhtml\+xml))/.test(type)) throw new Error("This endpoint is not a text/HTML/JSON response (" + type + ").");
  const text = (await response.text()).slice(0, 80000);
  return { url: url.toString(), status: response.status, contentType: type, text };
}