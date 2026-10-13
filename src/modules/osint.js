const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, max-age=60" } });

function parseTarget(raw) {
  const value = String(raw || "").trim();
  if (!value || value.length > 253) throw new Error("Enter a public domain or IPv4 address.");
  let host = value;
  if (/^https?:\/\//i.test(value)) {
    let url;
    try { url = new URL(value); } catch { throw new Error("Invalid target URL."); }
    if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) throw new Error("Only public HTTP/HTTPS targets are supported.");
    host = url.hostname;
  } else if (/[\s\/@?#]/.test(value)) throw new Error("Enter a domain, URL, or public IPv4 address.");
  host = host.toLowerCase().replace(/\.$/, "");
  if (!host || host.includes(":") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Local, private, and IPv6 targets are not supported.");
  const parts = host.split(".");
  const ipv4 = parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  if (ipv4) {
    const [a, b] = parts.map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) throw new Error("Use a publicly routable IP address.");
    return { host, ipv4: true };
  }
  if (!host.includes(".") || !parts.every(label => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) || /^\d+(?:\.\d+){3}$/.test(host)) throw new Error("Enter a valid public domain name or IPv4 address.");
  return { host, ipv4: false };
}

async function getJson(url) {
  const response = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": "OpenSourceAI-Me-OSINT/1.0" }, signal: AbortSignal.timeout(6500), redirect: "error" });
  if (!response.ok) throw new Error("Source returned HTTP " + response.status);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("json") && !type.includes("javascript")) throw new Error("Source did not return JSON.");
  return response.json();
}
async function source(name, fn, summarize) {
  try { return { name, ok: true, data: summarize(await fn()) }; }
  catch (error) { return { name, ok: false, error: String(error?.message || error).slice(0, 120) }; }
}

export async function handleOsint(request) {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
  const url = new URL(request.url);
  let target;
  try { target = parseTarget(url.searchParams.get("target")); }
  catch (error) { return json({ error: error.message }, 400); }
  const { host, ipv4 } = target;
  const jobs = [
    source("RDAP", () => getJson("https://rdap.org/" + (ipv4 ? "ip/" : "domain/") + encodeURIComponent(host)), data => ({
      handle: data.handle || data.ldhName || data.name || null,
      status: Array.isArray(data.status) ? data.status.slice(0, 10) : [],
      events: Array.isArray(data.events) ? data.events.slice(0, 8).map(e => ({ action: e.eventAction, date: e.eventDate })) : [],
      nameservers: Array.isArray(data.nameservers) ? data.nameservers.slice(0, 20).map(n => n.ldhName).filter(Boolean) : [],
      entities: Array.isArray(data.entities) ? data.entities.slice(0, 12).map(e => ({ roles: e.roles, handle: e.handle })).filter(e => e.handle || e.roles?.length) : [],
      network: data.startAddress || data.endAddress ? { start: data.startAddress, end: data.endAddress, name: data.name, country: data.country } : null
    }))
  ];
  if (!ipv4) {
    jobs.push(source("Public DNS (A)", () => getJson("https://dns.google/resolve?name=" + encodeURIComponent(host) + "&type=A"), data => ({
      status: data.Status,
      answers: Array.isArray(data.Answer) ? data.Answer.slice(0, 20).map(a => ({ name: a.name, type: a.type, ttl: a.TTL, data: a.data })) : []
    })));
    jobs.push(source("Certificate Transparency", () => getJson("https://crt.sh/?q=%25." + encodeURIComponent(host) + "&output=json"), data => ({
      certificates: Array.isArray(data) ? data.slice(0, 30).map(c => ({ issuer: c.issuer_name, commonName: c.common_name, nameValue: String(c.name_value || "").slice(0, 500), notBefore: c.not_before, notAfter: c.not_after })).filter(c => c.commonName || c.nameValue) : []
    })));
  }
  const results = await Promise.all(jobs);
  return json({ target: host, targetType: ipv4 ? "public-ipv4" : "domain", checkedAt: new Date().toISOString(), sources: results });
}
