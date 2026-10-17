const json = (data, status = 200) => Response.json(data, { status });

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
  const usage = await db.prepare(`
    SELECT COUNT(*) AS requests,
           COALESCE(SUM(input_characters),0) AS inputCharacters,
           COALESCE(SUM(image_count),0) AS images,
           MIN(created_at) AS firstEventAt
    FROM usage_events
    WHERE user_id=? AND created_at >= strftime('%Y-%m-01T00:00:00.000Z','now')
  `).bind(userId).first();
  const limit = PLAN_LIMITS[plan].monthlyRequests;
  const requests = Number(usage?.requests || 0);
  const tokenBalance = Math.max(0, Number(user?.token_balance || 0));
  const planRemaining = Math.max(0, limit - requests);
  return {
    plan,
    planLabel: PLAN_LIMITS[plan].label,
    period: "calendar_month",
    requests,
    monthlyLimit: limit,
    planRemaining,
    tokenBalance,
    remaining: planRemaining + tokenBalance,
    allowed: requests < limit || tokenBalance > 0,
    inputCharacters: Number(usage?.inputCharacters || 0),
    images: Number(usage?.images || 0),
    firstEventAt: usage?.firstEventAt || null
  };
}

export async function checkPlanQuota(db, userId) {
  return readPlanUsage(db, userId);
}

export async function recordUsage(db, userId, { moduleId = "ai-engine", inputCharacters = 0, imageCount = 0 } = {}) {
  await ensureUsageSchema(db);
  const account = await db.prepare("SELECT plan FROM users WHERE id=?").bind(userId).first();
  const plan = Object.hasOwn(PLAN_LIMITS, String(account?.plan || "free").toLowerCase()) ? String(account?.plan || "free").toLowerCase() : "free";
  const limit = PLAN_LIMITS[plan].monthlyRequests;
  const usage = await db.prepare("SELECT COUNT(*) AS requests FROM usage_events WHERE user_id=? AND created_at >= strftime('%Y-%m-01T00:00:00.000Z','now')").bind(userId).first();
  if (Number(usage?.requests || 0) >= limit) {
    const spent = await db.prepare("UPDATE users SET token_balance=token_balance-1 WHERE id=? AND token_balance>0").bind(userId).run();
    if (!Number(spent?.meta?.changes || 0)) {
      // Avoid turning a successful AI response into an error if concurrent requests exhaust credits.
    }
  }
  await db.prepare(
    "INSERT INTO usage_events (id,user_id,module_id,input_characters,image_count) VALUES (?,?,?,?,?)"
  ).bind(crypto.randomUUID(), userId, String(moduleId).slice(0, 64), Math.max(0, Math.floor(inputCharacters)), Math.max(0, Math.floor(imageCount))).run();
}

export async function handleUsage(request, env, user) {
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  const status = await readPlanUsage(env.DB, user.id);
  const grouped = await env.DB.prepare(`
    SELECT module_id AS moduleId, COUNT(*) AS requests,
           COALESCE(SUM(image_count),0) AS images
    FROM usage_events
    WHERE user_id=? AND created_at >= strftime('%Y-%m-01T00:00:00.000Z','now')
    GROUP BY module_id ORDER BY requests DESC
  `).bind(user.id).all();
  return json({
    ...status,
    byModule: grouped.results || [],
    metering: "One bonus token pays for one AI request after the plan's monthly request limit. Prompt, response, and image contents are not stored in usage_events."
  });
}
