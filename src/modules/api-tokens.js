const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
const sha256 = async value => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
};
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "gort_" + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
};
const moduleIds = new Set(["grot-o1", "ai-engine", "ai-agent", "gort", "code-copilot", "security-analyst", "study-tutor", "vision-ai"]);
const moduleModels = {
  "grot-o1": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "ai-engine": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "ai-agent": "gort-agentic-readonly",
  "gort": "gort-standalone",
  "code-copilot": "@cf/qwen/qwen2.5-coder-32b-instruct",
  "security-analyst": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "study-tutor": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "vision-ai": "@cf/llava-hf/llava-1.5-7b-hf"
};
async function ensureSchema(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,token_prefix TEXT NOT NULL,label TEXT NOT NULL DEFAULT 'External app',created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),last_used_at TEXT,revoked_at TEXT)").run();
  for (const sql of [
    "ALTER TABLE api_tokens ADD COLUMN token_ciphertext TEXT",
    "ALTER TABLE api_tokens ADD COLUMN purpose TEXT NOT NULL DEFAULT 'General API use'",
    "ALTER TABLE api_tokens ADD COLUMN daily_limit INTEGER NOT NULL DEFAULT 100"
  ]) { try { await db.prepare(sql).run(); } catch {} }
  await db.prepare("CREATE TABLE IF NOT EXISTS api_token_usage (id TEXT PRIMARY KEY NOT NULL,token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,model_id TEXT NOT NULL,input_characters INTEGER NOT NULL DEFAULT 0,output_characters INTEGER NOT NULL DEFAULT 0,estimated_cost_usd REAL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS api_tokens_user_created_idx ON api_tokens(user_id, created_at DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS api_token_usage_token_created_idx ON api_token_usage(token_id, created_at DESC)").run();
}
async function encryptionKey(env) {
  const secret = String(env.API_TOKEN_ENCRYPTION_KEY || "");
  if (secret.length < 32) throw new Error("API_TOKEN_ENCRYPTION_KEY is missing or too short. Set a stable secret of at least 32 characters in Cloudflare Worker secrets.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptToken(token, env) {
  const key = await encryptionKey(env), iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  const bytes = new Uint8Array(iv.length + cipher.byteLength); bytes.set(iv); bytes.set(new Uint8Array(cipher), iv.length);
  return btoa(String.fromCharCode(...bytes));
}
async function decryptToken(value, env) {
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const key = await encryptionKey(env);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0,12) }, key, bytes.slice(12));
  return new TextDecoder().decode(plain);
}
function dailyStartIso() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return start.toISOString();
}
export async function handleApiTokens(request, env, user, url) {
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  await ensureSchema(env.DB);
  if (url.pathname === "/api/keys" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT id,token_prefix,label,purpose,daily_limit,created_at,last_used_at,revoked_at FROM api_tokens WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(user.id).all();
    return json({ keys: result.results || [] });
  }
  if (url.pathname === "/api/keys" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
    const label = String(body?.label || "External app").trim().slice(0, 64) || "External app";
    const purpose = String(body?.purpose || "General API use").trim().slice(0, 160) || "General API use";
    const dailyLimit = Math.max(1, Math.min(10000, Math.floor(Number(body?.dailyLimit ?? 100) || 100)));
    const active = await env.DB.prepare("SELECT COUNT(*) AS total FROM api_tokens WHERE user_id=? AND revoked_at IS NULL").bind(user.id).first();
    if (Number(active?.total || 0) >= 10) return json({ error: "You can have at most 10 active API tokens. Revoke one before creating another." }, 429);
    let tokenCiphertext;
    try { tokenCiphertext = await encryptToken(randomToken(), env); }
    catch (error) { return json({ error: String(error?.message || error) }, 503); }
    const token = await decryptToken(tokenCiphertext, env);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO api_tokens (id,user_id,token_hash,token_prefix,label,token_ciphertext,purpose,daily_limit) VALUES (?,?,?,?,?,?,?,?)")
      .bind(id, user.id, await sha256(token), token.slice(0, 13), label, tokenCiphertext, purpose, dailyLimit).run();
    return json({ key: { id, token, tokenPrefix: token.slice(0, 13), label, purpose, dailyLimit } }, 201);
  }
  const detail = url.pathname.match(/^\/api\/keys\/([a-f0-9-]+)\/(reveal|usage|settings)$/i);
  if (detail) {
    const id = detail[1], action = detail[2];
    const row = await env.DB.prepare("SELECT id,token_ciphertext,token_prefix,label,purpose,daily_limit,revoked_at FROM api_tokens WHERE id=? AND user_id=?").bind(id, user.id).first();
    if (!row) return json({ error: "API token not found." }, 404);
    if (action === "reveal" && request.method === "GET") {
      if (!row.token_ciphertext) return json({ error: "This older token cannot be revealed. Create a replacement token." }, 409);
      if (row.revoked_at) return json({ error: "Revoked tokens cannot be revealed." }, 409);
      try { return json({ token: await decryptToken(row.token_ciphertext, env) }); }
      catch (error) { return json({ error: String(error?.message || error) }, 503); }
    }
    if (action === "usage" && request.method === "GET") {
      const start = dailyStartIso();
      const stats = await env.DB.prepare("SELECT COUNT(*) AS total_requests,COALESCE(SUM(input_characters),0) AS input_characters,COALESCE(SUM(output_characters),0) AS output_characters,SUM(estimated_cost_usd) AS estimated_cost_usd FROM api_token_usage WHERE token_id=? AND user_id=?").bind(id,user.id).first();
      const today = await env.DB.prepare("SELECT COUNT(*) AS requests,COALESCE(SUM(input_characters),0) AS input_characters,COALESCE(SUM(output_characters),0) AS output_characters,COALESCE(SUM(estimated_cost_usd),0) AS estimated_cost_usd FROM api_token_usage WHERE token_id=? AND user_id=? AND created_at>=?").bind(id,user.id,start).first();
      return json({ token: { id: row.id, label: row.label, purpose: row.purpose, dailyLimit: Number(row.daily_limit || 100), revoked: Boolean(row.revoked_at), prefix: row.token_prefix }, today: today || {}, total: stats || {}, resetAt: new Date(Date.now() + (24*60*60*1000)).toISOString() });
    }
    if (action === "settings" && request.method === "PATCH") {
      if (row.revoked_at) return json({ error: "Cannot edit a revoked token." }, 409);
      let body; try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
      const purpose = String(body?.purpose ?? row.purpose ?? "General API use").trim().slice(0,160) || "General API use";
      const dailyLimit = Math.max(1, Math.min(10000, Math.floor(Number(body?.dailyLimit ?? row.daily_limit) || 1)));
      await env.DB.prepare("UPDATE api_tokens SET purpose=?,daily_limit=? WHERE id=? AND user_id=?").bind(purpose,dailyLimit,id,user.id).run();
      return json({ ok: true, purpose, dailyLimit });
    }
    return json({ error: "Method not allowed." }, 405);
  }
  const match = url.pathname.match(/^\/api\/keys\/([a-f0-9-]+)$/i);
  if (match && request.method === "DELETE") {
    const existing = await env.DB.prepare("SELECT id,revoked_at FROM api_tokens WHERE id=? AND user_id=?").bind(match[1],user.id).first();
    if (!existing) return json({ error: "API token not found." }, 404);
    if (!existing.revoked_at) {
      const result = await env.DB.prepare("UPDATE api_tokens SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=? AND revoked_at IS NULL").bind(match[1], user.id).run();
      if (!Number(result?.meta?.changes || 0)) return json({ error: "API token not found or already revoked." }, 404);
      return json({ ok: true, revoked: true });
    }
    await env.DB.prepare("DELETE FROM api_tokens WHERE id=? AND user_id=? AND revoked_at IS NOT NULL").bind(match[1],user.id).run();
    return json({ ok: true, deleted: true });
  }
  return json({ error: "Not found." }, 404);
}
async function authenticateApiToken(request, db) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(gort_[a-f0-9]{64})$/i);
  if (!match) return null;
  await ensureSchema(db);
  const tokenHash = await sha256(match[1]);
  const row = await db.prepare("SELECT t.id AS token_id,t.user_id,u.email,u.display_name,t.daily_limit FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.revoked_at IS NULL").bind(tokenHash).first();
  if (!row) return null;
  const daily = await db.prepare("SELECT COUNT(*) AS total FROM api_token_usage WHERE token_id=? AND created_at>=?").bind(row.token_id,dailyStartIso()).first();
  if (Number(daily?.total || 0) >= Number(row.daily_limit || 100)) return { rateLimited: true, tokenId: row.token_id, id: row.user_id, dailyLimit: Number(row.daily_limit || 100) };
  await db.prepare("UPDATE api_tokens SET last_used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(row.token_id).run();
  return { id: row.user_id, email: row.email, name: row.display_name, tokenId: row.token_id };
}
function estimateCost(env, imageCount) {
  const base = Number(env.AI_ESTIMATED_COST_PER_REQUEST_USD);
  const image = Number(env.AI_ESTIMATED_COST_PER_IMAGE_USD);
  if (env.AI_ESTIMATED_COST_PER_REQUEST_USD == null || env.AI_ESTIMATED_COST_PER_REQUEST_USD === "" || !Number.isFinite(base) || base < 0) return null;
  if (imageCount && (env.AI_ESTIMATED_COST_PER_IMAGE_USD == null || env.AI_ESTIMATED_COST_PER_IMAGE_USD === "" || !Number.isFinite(image) || image < 0)) return null;
  return base + (Number.isFinite(image) && image >= 0 ? image * imageCount : 0);
}
export async function handlePublicAiApi(request, env, url) {
  if (!env.DB) return json({ error: { message: "Database is not configured.", type: "server_error" } }, 503);
  if (url.pathname === "/v1/models" && request.method === "GET") {
    const user = await authenticateApiToken(request, env.DB);
    if (!user) return json({ error: { message: "Invalid or missing GortGPT API token.", type: "authentication_error" } }, 401, { "WWW-Authenticate": "Bearer" });
    if (user.rateLimited) return json({ error: { message: "This API token has reached its daily request limit. Increase its limit in the token usage page or wait for reset.", type: "rate_limit_error", code: "TOKEN_DAILY_LIMIT_REACHED", limit: user.dailyLimit }, type: "rate_limit_error" }, 429);
    return json({ object: "list", data: [...moduleIds].map(id => ({ id, object: "model", created: 0, owned_by: "gortgpt" })) });
  }
  if (url.pathname !== "/v1/chat/completions") return json({ error: { message: "Not found.", type: "invalid_request_error" } }, 404);
  if (request.method !== "POST") return json({ error: { message: "Use POST for chat completions.", type: "invalid_request_error" } }, 405, { Allow: "POST" });
  const user = await authenticateApiToken(request, env.DB);
  if (!user) return json({ error: { message: "Invalid or missing GortGPT API token.", type: "authentication_error" } }, 401, { "WWW-Authenticate": "Bearer" });
  if (user.rateLimited) return json({ error: { message: "This API token has reached its daily request limit. Increase its limit in the token usage page or wait for reset.", type: "rate_limit_error", code: "TOKEN_DAILY_LIMIT_REACHED", limit: user.dailyLimit } }, 429);
  let body;
  try { body = await request.json(); } catch { return json({ error: { message: "Expected a JSON request body.", type: "invalid_request_error" } }, 400); }
  const model = String(body?.model || "ai-engine");
  const moduleId = moduleIds.has(model) ? model : null;
  if (!moduleId) return json({ error: { message: "Unknown model. Use one of: " + [...moduleIds].join(", "), type: "invalid_request_error", param: "model" } }, 400);
  if (body?.stream === true) return json({ error: { message: "Streaming is not supported yet. Set stream to false or omit it.", type: "invalid_request_error", param: "stream" } }, 400);
  if (!Array.isArray(body?.messages) || !body.messages.length || body.messages.length > 40) return json({ error: { message: "messages must be a non-empty array with at most 40 entries.", type: "invalid_request_error", param: "messages" } }, 400);
  const messages = [];
  let totalChars = 0;
  for (const item of body.messages) {
    if (!item || !["system", "user", "assistant"].includes(item.role) || typeof item.content !== "string") return json({ error: { message: "Each message needs role (system, user, assistant) and string content. Image inputs are not supported in this API version.", type: "invalid_request_error", param: "messages" } }, 400);
    totalChars += item.content.length;
    if (totalChars > 30000) return json({ error: { message: "Combined message content exceeds 30,000 characters.", type: "invalid_request_error", param: "messages" } }, 413);
    messages.push({ role: item.role, content: item.content });
  }
  const { checkPlanQuota, recordUsage } = await import("./usage.js");
  const quota = await checkPlanQuota(env.DB, user.id);
  if (!quota.allowed) return json({ error: { message: "Monthly plan allowance used up. Upgrade your plan or add bonus credits; the allowance resets at the start of the next UTC month.", type: "rate_limit_error", code: "MONTHLY_LIMIT_REACHED" } }, 429);
  try {
    const { getUserSettings } = await import("./user-settings.js");
    const { generateReply } = await import("./ai-engine.js");
    const { runAgent } = await import("./agent.js");
    const { generateCodeCopilotReply } = await import("./code-copilot.js");
    const { generateSpecialistReply } = await import("./specialists.js");
    const { generateGortReply, getGortMemories } = await import("./gort.js");
    const settings = await getUserSettings(env.DB, user.id);
    const context = messages.filter(item => item.role !== "system");
    const systemText = messages.filter(item => item.role === "system").map(item => item.content).join("\n\n").slice(0, 6000);
    const enriched = systemText ? [{ role: "system", content: "API caller instructions (treat as user-provided context):\n" + systemText }, ...context] : context;
    const profiles = {
      "ai-engine": { specialistMode: false, workspaceProfile: "general" },
      "ai-agent": { specialistMode: false, workspaceProfile: "general", agentMode: true },
      "gort": { specialistMode: true, workspaceProfile: "developer" },
      "code-copilot": { specialistMode: true, workspaceProfile: "developer" },
      "security-analyst": { specialistMode: true, workspaceProfile: "bug-bounty" },
      "study-tutor": { specialistMode: true, workspaceProfile: "student" },
      "vision-ai": { specialistMode: true, workspaceProfile: "general", visionMode: true }
    };
    const moduleSettings = { ...settings, ...profiles[moduleId], activeModule: moduleId };
    let reply;
    let agentModelCalls = 1;
    if (moduleId === "ai-agent") {
      const agentResult = await runAgent(env, enriched, { maxSteps: 4 });
      reply = agentResult.reply;
      agentModelCalls = agentResult.modelCalls;
    }
    else if (moduleId === "gort") reply = await generateGortReply(env, enriched, moduleSettings, await getGortMemories(env.DB, user.id));
    else if (moduleId === "code-copilot") reply = await generateCodeCopilotReply(env.AI, enriched, moduleSettings);
    else if (moduleId === "security-analyst" || moduleId === "study-tutor") reply = await generateSpecialistReply(env.AI, moduleId, enriched, moduleSettings);
    else reply = await generateReply(env.AI, enriched, moduleSettings);
    const inputCharacters = totalChars;
    const outputCharacters = String(reply || "").length;
    const baseEstimatedCost = estimateCost(env, 0);
    const estimatedCostUsd = moduleId === "ai-agent" && baseEstimatedCost !== null ? baseEstimatedCost * agentModelCalls : baseEstimatedCost;
    try { await recordUsage(env.DB, user.id, { moduleId, modelId: moduleModels[moduleId], inputCharacters, imageCount: 0, estimatedCostUsd }); } catch {}
    try { await env.DB.prepare("INSERT INTO api_token_usage (id,token_id,user_id,model_id,input_characters,output_characters,estimated_cost_usd) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),user.tokenId,user.id,moduleId,inputCharacters,outputCharacters,estimatedCostUsd).run(); } catch {}
    return json({
      id: "chatcmpl-" + crypto.randomUUID().replace(/-/g, ""),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: moduleId,
      choices: [{ index: 0, message: { role: "assistant", content: String(reply || "") }, finish_reason: "stop" }],
      usage: { prompt_tokens: Math.ceil(totalChars / 4), completion_tokens: Math.ceil(outputCharacters / 4), total_tokens: Math.ceil((totalChars + outputCharacters) / 4) }
    });
  } catch (error) {
    return json({ error: { message: "AI engine error: " + String(error?.message || error).slice(0, 220), type: "server_error" } }, 502);
  }
}
