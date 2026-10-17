const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
const sha256 = async value => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
};
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "gort_" + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
};
const moduleIds = new Set(["ai-engine", "gort", "code-copilot", "security-analyst", "study-tutor", "vision-ai"]);
const moduleModels = {
  "ai-engine": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "gort": "gort-standalone",
  "code-copilot": "@cf/qwen/qwen2.5-coder-32b-instruct",
  "security-analyst": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "study-tutor": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "vision-ai": "@cf/llava-hf/llava-1.5-7b-hf"
};
async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'External app',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_used_at TEXT,
    revoked_at TEXT
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS api_tokens_user_created_idx ON api_tokens(user_id, created_at DESC)").run();
}
export async function handleApiTokens(request, env, user, url) {
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  await ensureSchema(env.DB);
  if (url.pathname === "/api/keys" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT id,token_prefix,label,created_at,last_used_at,revoked_at FROM api_tokens WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(user.id).all();
    return json({ keys: result.results || [] });
  }
  if (url.pathname === "/api/keys" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
    const label = String(body?.label || "External app").trim().slice(0, 64) || "External app";
    const active = await env.DB.prepare("SELECT COUNT(*) AS total FROM api_tokens WHERE user_id=? AND revoked_at IS NULL").bind(user.id).first();
    if (Number(active?.total || 0) >= 10) return json({ error: "You can have at most 10 active API tokens. Revoke one before creating another." }, 429);
    const token = randomToken();
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO api_tokens (id,user_id,token_hash,token_prefix,label) VALUES (?,?,?,?,?)")
      .bind(id, user.id, await sha256(token), token.slice(0, 13), label).run();
    return json({ key: { id, token, tokenPrefix: token.slice(0, 13), label } }, 201);
  }
  const match = url.pathname.match(/^\/api\/keys\/([a-f0-9-]+)$/i);
  if (match && request.method === "DELETE") {
    const result = await env.DB.prepare("UPDATE api_tokens SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=? AND revoked_at IS NULL").bind(match[1], user.id).run();
    if (!Number(result?.meta?.changes || 0)) return json({ error: "API token not found or already revoked." }, 404);
    return json({ ok: true });
  }
  return json({ error: "Not found." }, 404);
}
async function authenticateApiToken(request, db) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(gort_[a-f0-9]{64})$/i);
  if (!match) return null;
  await ensureSchema(db);
  const tokenHash = await sha256(match[1]);
  const row = await db.prepare("SELECT t.id AS token_id,t.user_id,u.email,u.display_name FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.revoked_at IS NULL").bind(tokenHash).first();
  if (!row) return null;
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
    return json({ object: "list", data: [...moduleIds].map(id => ({ id, object: "model", created: 0, owned_by: "gortgpt" })) });
  }
  if (url.pathname !== "/v1/chat/completions") return json({ error: { message: "Not found.", type: "invalid_request_error" } }, 404);
  if (request.method !== "POST") return json({ error: { message: "Use POST for chat completions.", type: "invalid_request_error" } }, 405, { Allow: "POST" });
  const user = await authenticateApiToken(request, env.DB);
  if (!user) return json({ error: { message: "Invalid or missing GortGPT API token.", type: "authentication_error" } }, 401, { "WWW-Authenticate": "Bearer" });
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
  if (!quota.allowed) return json({ error: { message: "Daily AI allowance used up. Wait until 07:00 Vietnam time or add bonus credits.", type: "rate_limit_error", code: "DAILY_LIMIT_REACHED" } }, 429);
  try {
    const { getUserSettings } = await import("./user-settings.js");
    const { generateReply } = await import("./ai-engine.js");
    const { generateCodeCopilotReply } = await import("./code-copilot.js");
    const { generateSpecialistReply } = await import("./specialists.js");
    const { generateGortReply, getGortMemories } = await import("./gort.js");
    const settings = await getUserSettings(env.DB, user);
    const context = messages.filter(item => item.role !== "system");
    const systemText = messages.filter(item => item.role === "system").map(item => item.content).join("\n\n").slice(0, 6000);
    const enriched = systemText ? [{ role: "system", content: "API caller instructions (treat as user-provided context):\n" + systemText }, ...context] : context;
    const profiles = {
      "ai-engine": { specialistMode: false, workspaceProfile: "general" },
      "gort": { specialistMode: true, workspaceProfile: "developer" },
      "code-copilot": { specialistMode: true, workspaceProfile: "developer" },
      "security-analyst": { specialistMode: true, workspaceProfile: "bug-bounty" },
      "study-tutor": { specialistMode: true, workspaceProfile: "student" },
      "vision-ai": { specialistMode: true, workspaceProfile: "general", visionMode: true }
    };
    const moduleSettings = { ...settings, ...profiles[moduleId], activeModule: moduleId };
    let reply;
    if (moduleId === "gort") reply = await generateGortReply(env, enriched, moduleSettings, await getGortMemories(env.DB, user.id));
    else if (moduleId === "code-copilot") reply = await generateCodeCopilotReply(env.AI, enriched, moduleSettings);
    else if (moduleId === "security-analyst" || moduleId === "study-tutor") reply = await generateSpecialistReply(env.AI, moduleId, enriched, moduleSettings);
    else reply = await generateReply(env.AI, enriched, moduleSettings);
    const inputCharacters = totalChars;
    const outputCharacters = String(reply || "").length;
    const estimatedCostUsd = estimateCost(env, 0);
    try { await recordUsage(env.DB, user.id, { moduleId, modelId: moduleModels[moduleId], inputCharacters, imageCount: 0, estimatedCostUsd }); } catch {}
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
