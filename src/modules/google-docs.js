const DOCS_SCOPE = "https://www.googleapis.com/auth/documents.create";
const CALLBACK_PATH = "/api/integrations/google/callback";
const COOKIE_NAME = "grot_google_oauth_state";
const json = (data, status = 200) => Response.json(data, { status });
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const fromB64url = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
const encoder = new TextEncoder();
function cookieValue(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}
function cookieHeader(value, maxAge) {
  return COOKIE_NAME + "=" + encodeURIComponent(value) + "; Path=" + CALLBACK_PATH + "; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}
function redirect(url, cookie) {
  const headers = new Headers({ Location: url.toString(), "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}
function config(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error("Google Docs is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as Worker secrets.");
  if (typeof env.API_TOKEN_ENCRYPTION_KEY !== "string" || env.API_TOKEN_ENCRYPTION_KEY.length < 32) throw new Error("API_TOKEN_ENCRYPTION_KEY must be a stable secret of at least 32 characters to protect Google OAuth tokens.");
}
async function hmacKey(env) {
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", encoder.encode(env.API_TOKEN_ENCRYPTION_KEY)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signState(env, payload) {
  const encoded = b64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env), encoder.encode(encoded));
  return encoded + "." + b64url(signature);
}
async function verifyState(env, value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 2) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(env), fromB64url(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    if (!payload.userId || !payload.nonce || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch { return null; }
}
async function encryptionKey(env) {
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", encoder.encode(env.API_TOKEN_ENCRYPTION_KEY)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), encoder.encode(value));
  return b64url(iv) + "." + b64url(encrypted);
}
async function decrypt(env, value) {
  const [iv, ciphertext] = String(value || "").split(".");
  if (!iv || !ciphertext) throw new Error("Stored Google token is invalid. Reconnect Google Docs.");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await encryptionKey(env), fromB64url(ciphertext));
  return new TextDecoder().decode(plain);
}
function callbackUrl(request) { return new URL(CALLBACK_PATH, new URL(request.url).origin).toString(); }
async function exchangeCode(request, env, code) {
  const body = new URLSearchParams({
    code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: callbackUrl(request), grant_type: "authorization_code"
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.refresh_token) throw new Error("Google OAuth did not return a refresh token. Reconnect and approve offline access.");
  return data;
}
async function getAccessToken(env, userId) {
  const row = await env.DB.prepare("SELECT refresh_token_enc FROM google_docs_connections WHERE user_id=?").bind(userId).first();
  if (!row?.refresh_token_enc) throw new Error("Connect Google Docs first.");
  const refreshToken = await decrypt(env, row.refresh_token_enc);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    if (data.error === "invalid_grant") await env.DB.prepare("DELETE FROM google_docs_connections WHERE user_id=?").bind(userId).run();
    throw new Error("Could not refresh Google access. Reconnect Google Docs in Settings.");
  }
  return data.access_token;
}
export async function handleGoogleOAuthCallback(request, env) {
  const url = new URL(request.url);
  const clearCookie = cookieHeader("", 0);
  if (url.searchParams.has("error")) return redirect(new URL("/chat.html?google_docs=cancelled", url.origin), clearCookie);
  const state = url.searchParams.get("state") || "";
  if (!state || state !== cookieValue(request, COOKIE_NAME)) return redirect(new URL("/chat.html?google_docs=state_error", url.origin), clearCookie);
  try {
    config(env);
    const payload = await verifyState(env, state);
    const code = url.searchParams.get("code") || "";
    if (!payload || !code) return redirect(new URL("/chat.html?google_docs=state_error", url.origin), clearCookie);
    const tokens = await exchangeCode(request, env, code);
    const encrypted = await encrypt(env, tokens.refresh_token);
    await env.DB.prepare("INSERT INTO google_docs_connections (user_id,refresh_token_enc,scope) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET refresh_token_enc=excluded.refresh_token_enc,scope=excluded.scope,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(payload.userId, encrypted, tokens.scope || DOCS_SCOPE).run();
    return redirect(new URL("/chat.html?google_docs=connected", url.origin), clearCookie);
  } catch {
    return redirect(new URL("/chat.html?google_docs=error", url.origin), clearCookie);
  }
}
export async function handleGoogleIntegration(request, env, user, url) {
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  if (url.pathname === "/api/integrations/google/connect" && request.method === "GET") {
    try {
      config(env);
      const state = await signState(env, { userId: user.id, nonce: b64url(crypto.getRandomValues(new Uint8Array(24))), exp: Date.now() + 10 * 60 * 1000 });
      const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      target.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
      target.searchParams.set("redirect_uri", callbackUrl(request));
      target.searchParams.set("response_type", "code");
      target.searchParams.set("scope", DOCS_SCOPE);
      target.searchParams.set("access_type", "offline");
      target.searchParams.set("prompt", "consent");
      target.searchParams.set("state", state);
      return redirect(target, cookieHeader(state, 600));
    } catch (error) { return json({ error: String(error?.message || error) }, 503); }
  }
  if (url.pathname === "/api/integrations/google/status" && request.method === "GET") {
    const row = await env.DB.prepare("SELECT connected_at,scope FROM google_docs_connections WHERE user_id=?").bind(user.id).first();
    return json({ connected: Boolean(row), connectedAt: row?.connected_at || null, scope: row?.scope || null });
  }
  if (url.pathname === "/api/integrations/google/disconnect" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM google_docs_connections WHERE user_id=?").bind(user.id).run();
    return json({ ok: true, connected: false });
  }
  if (url.pathname === "/api/integrations/google/docs" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
    const title = String(body?.title || "Grot-O1 research report").trim().slice(0, 180);
    const content = String(body?.content || "").trim();
    if (!content) return json({ error: "Report content is required." }, 400);
    if (content.length > 80000) return json({ error: "Report is too long (80,000 characters maximum)." }, 413);
    try {
      config(env);
      const accessToken = await getAccessToken(env, user.id);
      const createdResponse = await fetch("https://docs.googleapis.com/v1/documents", {
        method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ title }), signal: AbortSignal.timeout(12000)
      });
      const document = await createdResponse.json().catch(() => ({}));
      if (!createdResponse.ok || !document.documentId) throw new Error("Google Docs create failed (HTTP " + createdResponse.status + "). Check that Google Docs API is enabled for your Google Cloud project.");
      const insertResponse = await fetch("https://docs.googleapis.com/v1/documents/" + encodeURIComponent(document.documentId) + ":batchUpdate", {
        method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: content } }] }), signal: AbortSignal.timeout(12000)
      });
      if (!insertResponse.ok) throw new Error("Google Docs was created, but adding the report text failed (HTTP " + insertResponse.status + ").");
      return json({ ok: true, documentId: document.documentId, title: document.title || title, url: "https://docs.google.com/document/d/" + document.documentId + "/edit" }, 201);
    } catch (error) { return json({ error: String(error?.message || error).slice(0, 260) }, 502); }
  }
  return json({ error: "Not found." }, 404);
}
