const json = (data, status = 200) => Response.json(data, { status });

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

export async function recordUsage(db, userId, { moduleId = "ai-engine", inputCharacters = 0, imageCount = 0 } = {}) {
  await ensureUsageSchema(db);
  await db.prepare(
    "INSERT INTO usage_events (id,user_id,module_id,input_characters,image_count) VALUES (?,?,?,?,?)"
  ).bind(crypto.randomUUID(), userId, String(moduleId).slice(0, 64), Math.max(0, Math.floor(inputCharacters)), Math.max(0, Math.floor(imageCount))).run();
}

export async function handleUsage(request, env, user) {
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  await ensureUsageSchema(env.DB);
  const totals = await env.DB.prepare(`
    SELECT COUNT(*) AS requests,
           COALESCE(SUM(input_characters),0) AS inputCharacters,
           COALESCE(SUM(image_count),0) AS images,
           MIN(created_at) AS firstEventAt
    FROM usage_events
    WHERE user_id=? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')
  `).bind(user.id).first();
  const grouped = await env.DB.prepare(`
    SELECT module_id AS moduleId, COUNT(*) AS requests,
           COALESCE(SUM(image_count),0) AS images
    FROM usage_events
    WHERE user_id=? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')
    GROUP BY module_id ORDER BY requests DESC
  `).bind(user.id).all();
  return json({
    period: "last_30_days",
    requests: Number(totals?.requests || 0),
    inputCharacters: Number(totals?.inputCharacters || 0),
    images: Number(totals?.images || 0),
    firstEventAt: totals?.firstEventAt || null,
    byModule: grouped.results || [],
    metering: "request metadata only; prompt and response contents are not stored in usage_events"
  });
}
