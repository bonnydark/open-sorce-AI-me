const json = (data, status = 200) => Response.json(data, { status });

export const DAILY_TOKEN_ALLOWANCE = 100;
export const PLAN_LIMITS = Object.freeze({
  free: { monthlyRequests: 100, label: "Free" },
  pro: { monthlyRequests: 2000, label: "Pro" },
  business: { monthlyRequests: 10000, label: "Business" }
});

let usageSchemaReady = null;
async function ensureUsageSchema(db) {
  if (!usageSchemaReady) {
    usageSchemaReady = (async () => {
      await db.prepare(`CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        module_id TEXT NOT NULL DEFAULT 'ai-engine',
        input_characters INTEGER NOT NULL DEFAULT 0,
        image_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`).run();
      await db.prepare("CREATE INDEX IF NOT EXISTS usage_events_user_created_idx ON usage_events(user_id, created_at DESC)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS usage_events_user_module_created_idx ON usage_events(user_id, module_id, created_at DESC)").run();
    })().catch(error => { usageSchemaReady = null; throw error; });
  }
  return usageSchemaReady;
}

async function readPlanUsage(db, userId) {
  await ensureUsageSchema(db);
  let user;
  try {
    user = await db.prepare("SELECT plan, token_balance FROM users WHERE id=?").bind(userId).first();
  } catch {
    user = { plan: "free", token_balance: 0 };
  }
  const requestedPlan = String(user?.plan || "free").toLowerCase();
  const plan = Object.hasOwn(PLAN_LIMITS, requestedPlan) ? requestedPlan : "free";
  const [monthly, daily] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS requests,
             COALESCE(SUM(input_characters),0) AS inputCharacters,
             COALESCE(SUM(image_count),0) AS images,
             MIN(created_at) AS firstEventAt
      FROM usage_events
      WHERE user_id=? AND created_at >= strftime('%Y-%m-01T00:00:00.000Z','now')
    `).bind(userId).first(),
    db.prepare("SELECT COUNT(*) AS requests FROM usage_events WHERE user_id=? AND created_at >= strftime('%Y-%m-%dT00:00:00.000Z','now')").bind(userId).first()
  ]);
  const monthlyRequests = Number(monthly?.requests || 0);
  const dailyRequests = Number(daily?.requests || 0);
  const tokenBalance = Math.max(0, Number(user?.token_balance || 0));
  const dailyRemaining = Math.max(0, DAILY_TOKEN_ALLOWANCE - dailyRequests);
  return {
    plan, planLabel: PLAN_LIMITS[plan].label,
    period: "calendar_day_utc",
    dailyAllowance: DAILY_TOKEN_ALLOWANCE,
    dailyRequests,
    dailyRemaining,
    requests: monthlyRequests,
    monthlyRequests,
    monthlyLimit: PLAN_LIMITS[plan].monthlyRequests,
    tokenBalance,
    remaining: dailyRemaining + tokenBalance,
    allowed: dailyRequests < DAILY_TOKEN_ALLOWANCE || tokenBalance > 0,
    inputCharacters: Number(monthly?.inputCharacters || 0),
    images: Number(monthly?.images || 0),
    firstEventAt: monthly?.firstEventAt || null
  };
}

export async function checkPlanQuota(db, userId) {
  return readPlanUsage(db, userId);
}

export async function recordUsage(db, userId, { moduleId = "ai-engine", modelId = "unknown", inputCharacters = 0, imageCount = 0, estimatedCostUsd = null } = {}) {
  await ensureUsageSchema(db);
  const daily = await db.prepare("SELECT COUNT(*) AS requests FROM usage_events WHERE user_id=? AND created_at >= strftime('%Y-%m-%dT00:00:00.000Z','now')").bind(userId).first();
  if (Number(daily?.requests || 0) >= DAILY_TOKEN_ALLOWANCE) {
    // Daily allowance is free and resets at UTC midnight. Bonus credits are only spent after it is exhausted.
    await db.prepare("UPDATE users SET token_balance=token_balance-1 WHERE id=? AND token_balance>0").bind(userId).run();
  }
  const cost = Number.isFinite(Number(estimatedCostUsd)) && estimatedCostUsd !== null && estimatedCostUsd !== "" ? Math.max(0, Number(estimatedCostUsd)) : null;
  await db.prepare(
    "INSERT INTO usage_events (id,user_id,module_id,model_id,input_characters,image_count,estimated_cost_usd) VALUES (?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), userId, String(moduleId).slice(0, 64), String(modelId || "unknown").slice(0, 120), Math.max(0, Math.floor(inputCharacters)), Math.max(0, Math.floor(imageCount)), cost).run();
}

export async function handleUsage(request, env, user) {
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  const status = await readPlanUsage(env.DB, user.id);
  const grouped = await env.DB.prepare(`
    SELECT module_id AS moduleId, COUNT(*) AS requests,
           COALESCE(SUM(image_count),0) AS images,
           COALESCE(SUM(estimated_cost_usd),0) AS estimatedCostUsd,
           SUM(CASE WHEN estimated_cost_usd IS NOT NULL THEN 1 ELSE 0 END) AS pricedRequests
    FROM usage_events
    WHERE user_id=? AND created_at >= strftime('%Y-%m-%dT00:00:00.000Z','now')
    GROUP BY module_id ORDER BY requests DESC
  `).bind(user.id).all();
  return json({
    ...status,
    byModule: grouped.results || [],
    metering: "Every account gets 100 AI requests per UTC day. After the daily allowance is used, each further request consumes one admin-granted bonus credit. Daily allowance resets at 00:00 UTC (07:00 Vietnam time). Estimated cost is shown only when an administrator configures AI_ESTIMATED_COST_PER_REQUEST_USD and/or AI_ESTIMATED_COST_PER_IMAGE_USD. Prompt, response, and image contents are not stored in usage_events."
  });
}
