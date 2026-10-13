const defaults = {
  theme: "redline",
  typewriter: true,
  typewriterSpeed: 18,
  codeBlocks: true,
  answerStyle: "balanced",
  activeModule: "ai-engine"
};
const json = (data, status = 200) => Response.json(data, { status });
const allowedThemes = new Set(["redline", "midnight", "ocean", "violet", "light"]);
const allowedStyles = new Set(["concise", "balanced", "detailed"]);
function cleanSettings(input = {}) {
  return {
    theme: allowedThemes.has(input.theme) ? input.theme : defaults.theme,
    typewriter: input.typewriter !== false,
    typewriterSpeed: Math.max(0, Math.min(80, Number.isFinite(Number(input.typewriterSpeed)) ? Math.round(Number(input.typewriterSpeed)) : defaults.typewriterSpeed)),
    codeBlocks: input.codeBlocks !== false,
    answerStyle: allowedStyles.has(input.answerStyle) ? input.answerStyle : defaults.answerStyle,
    activeModule: "ai-engine"
  };
}
export async function getUserSettings(db, userId) {
  const row = await db.prepare("SELECT settings_json FROM users WHERE id=?").bind(userId).first();
  let saved = {};
  try { saved = JSON.parse(row?.settings_json || "{}"); } catch {}
  return { ...defaults, ...cleanSettings(saved) };
}
export async function handleUserSettings(request, env, user) {
  if (!env.DB) return json({ error: "D1 database binding DB is missing." }, 503);
  if (request.method === "GET") return json({ settings: await getUserSettings(env.DB, user.id) });
  if (request.method !== "PUT") return json({ error: "Method not allowed." }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
  const settings = cleanSettings(body?.settings || body || {});
  await env.DB.prepare("UPDATE users SET settings_json=? WHERE id=?").bind(JSON.stringify(settings), user.id).run();
  return json({ ok: true, settings });
}
