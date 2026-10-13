const SESSION_COOKIE = "osm_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const PBKDF2_ITERATIONS = 310000;

const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
const randomHex = (length = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
};
const toHex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
const fromHex = value => Uint8Array.from(value.match(/.{2}/g) || [], part => parseInt(part, 16));
const digest = async value => toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

async function passwordHash(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return toHex(bits);
}
function cookieValue(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const piece of raw.split(";")) {
    const i = piece.indexOf("=");
    if (i > -1 && piece.slice(0, i).trim() === name) return decodeURIComponent(piece.slice(i + 1).trim());
  }
  return "";
}
function sessionCookie(token, maxAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
async function createSession(db, userId) {
  const token = randomHex(32);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  await db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)")
    .bind(await digest(token), userId, expiresAt).run();
  return token;
}
export function publicUser(row) {
  return { id: row.id, email: row.email, name: row.display_name, createdAt: row.created_at };
}
export async function getSessionUser(request, env) {
  if (!env.DB) throw new Error("D1 database binding DB is missing.");
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await digest(token);
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    "SELECT u.id,u.email,u.display_name,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?"
  ).bind(tokenHash, now).first();
  if (!result) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(tokenHash).run();
    return null;
  }
  return publicUser(result);
}
export async function handleAuth(request, env, url) {
  if (!env.DB) return json({ error: "Database is not configured yet. Bind a Cloudflare D1 database as DB and apply migrations." }, 503);
  const path = url.pathname;
  if (path === "/api/auth/me" && request.method === "GET") {
    const user = await getSessionUser(request, env);
    return json({ user });
  }
  if (path === "/api/auth/logout" && request.method === "POST") {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }
  if ((path === "/api/auth/register" || path === "/api/auth/login") && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: "Enter a valid email address." }, 400);
    if (password.length < 8 || password.length > 256) return json({ error: "Password must be 8–256 characters." }, 400);

    let user;
    if (path.endsWith("/register")) {
      const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
      const salt = randomHex(16);
      const hash = await passwordHash(password, salt);
      const id = crypto.randomUUID();
      try {
        await env.DB.prepare("INSERT INTO users (id,email,display_name,password_salt,password_hash) VALUES (?,?,?,?,?)")
          .bind(id, email, name || email.split("@")[0], salt, hash).run();
      } catch (error) {
        if (/unique|constraint/i.test(String(error?.message || error))) return json({ error: "An account with this email already exists. Sign in instead." }, 409);
        throw error;
      }
      user = await env.DB.prepare("SELECT id,email,display_name,created_at FROM users WHERE id=?").bind(id).first();
    } else {
      const row = await env.DB.prepare("SELECT id,email,display_name,password_salt,password_hash,created_at FROM users WHERE email=?").bind(email).first();
      if (!row) return json({ error: "Email or password is incorrect." }, 401);
      const attempted = await passwordHash(password, row.password_salt);
      if (attempted !== row.password_hash) return json({ error: "Email or password is incorrect." }, 401);
      user = row;
    }
    const token = await createSession(env.DB, user.id);
    return json({ ok: true, user: publicUser(user) }, 200, { "Set-Cookie": sessionCookie(token) });
  }
  return json({ error: "Not found." }, 404);
}
