const defaults = {
  theme: "redline",
  customColorsEnabled: false,
  customColors: {},
  typewriter: true,
  typewriterSpeed: 18,
  codeBlocks: true,
  answerStyle: "balanced",
  personality: "classic",
  humorLevel: "low",
  researchMode: "on-demand",
  sandboxMode: true,
  activeModule: "ai-engine",
  ethicsLevel: 50,
  autoMemories: false,
  specialistMode: false,
  workspaceProfile: "general"
};
const json = (data, status = 200) => Response.json(data, { status });
const allowedThemes = new Set(["redline", "midnight", "ocean", "violet", "light"]);
const allowedStyles = new Set(["concise", "balanced", "detailed"]);
const allowedPersonalities = new Set(["serious", "casual", "classic", "playful", "custom"]);
const allowedHumor = new Set(["off", "low", "medium", "high"]);
const allowedResearch = new Set(["off", "on-demand", "proactive"]);
function safeCustomStyle(value) { return typeof value === "string" ? value.replace(/[<>]/g, "").trim().slice(0, 500) : ""; }
const allowedProfiles = new Set(["general", "bug-bounty", "developer", "student"]);
const allowedModules = new Set(["ai-engine", "code-copilot", "security-analyst", "study-tutor", "vision-ai", "gort"]);
function cleanSettings(input = {}) {
  const rawColors = input.customColors && typeof input.customColors === "object" && !Array.isArray(input.customColors) ? input.customColors : {};
  const color = (key, fallback) => typeof rawColors[key] === "string" && /^#[0-9a-fA-F]{6}$/.test(rawColors[key]) ? rawColors[key].toLowerCase() : fallback;
  return {
    theme: allowedThemes.has(input.theme) ? input.theme : defaults.theme,
    customColorsEnabled: input.customColorsEnabled === true,
    customColors: { text: color("text", "#f0fff6"), accent: color("accent", "#45f39a"), background: color("background", "#050807"), panel: color("panel", "#0d1712"), border: color("border", "#24513b"), userBubble: color("userBubble", "#102a1c"), assistantBubble: color("assistantBubble", "#0d1712") },
    typewriter: input.typewriter !== false,
    typewriterSpeed: Math.max(0, Math.min(80, Number.isFinite(Number(input.typewriterSpeed)) ? Math.round(Number(input.typewriterSpeed)) : defaults.typewriterSpeed)),
    codeBlocks: input.codeBlocks !== false,
    answerStyle: allowedStyles.has(input.answerStyle) ? input.answerStyle : defaults.answerStyle,
    personality: allowedPersonalities.has(input.personality) ? input.personality : defaults.personality,
    humorLevel: allowedHumor.has(input.humorLevel) ? input.humorLevel : defaults.humorLevel,
    customStyle: safeCustomStyle(input.customStyle),
    researchMode: allowedResearch.has(input.researchMode) ? input.researchMode : defaults.researchMode,
    sandboxMode: input.sandboxMode !== false,
    activeModule: allowedModules.has(input.activeModule) ? input.activeModule : defaults.activeModule,
    ethicsLevel: Math.max(0, Math.min(100, Number.isFinite(Number(input.ethicsLevel)) ? Math.round(Number(input.ethicsLevel)) : defaults.ethicsLevel)),
    autoMemories: input.autoMemories === true,
    specialistMode: input.specialistMode === true,
    workspaceProfile: allowedProfiles.has(input.workspaceProfile) ? input.workspaceProfile : defaults.workspaceProfile
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
