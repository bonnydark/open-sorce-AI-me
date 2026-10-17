const json = (data, status = 200) => Response.json(data, { status });

export function isAdminUser(user, env) {
  const configuredEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  return Boolean(configuredEmail && user?.email && String(user.email).trim().toLowerCase() === configuredEmail);
}

const monthStart = () => {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
};

export async function handleAdminApi(request, env, user, url) {
  if (!isAdminUser(user, env)) return json({ error: "Not found." }, 404);
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  const path = url.pathname;
  const start = monthStart();

  if (path === "/api/admin/overview" && request.method === "GET") {
    const [totals, plans, users] = await Promise.all([
      env.DB.prepare(`
        SELECT COUNT(*) AS users,
          (SELECT COUNT(*) FROM conversations) AS conversations,
          (SELECT COUNT(*) FROM usage_events WHERE created_at >= ?) AS requestsThisMonth,
          (SELECT COALESCE(SUM(estimated_cost_usd),0) FROM usage_events WHERE created_at >= ?) AS estimatedCostUsd,
          (SELECT COUNT(estimated_cost_usd) FROM usage_events WHERE created_at >= ?) AS pricedRequests
        FROM users
      `).bind(start, start, start).first(),
      env.DB.prepare("SELECT plan, COUNT(*) AS count FROM users GROUP BY plan ORDER BY plan").all(),
      env.DB.prepare(`
        SELECT u.id, u.email, u.display_name AS name, u.plan, u.token_balance AS tokens, u.created_at AS createdAt,
          (SELECT COUNT(*) FROM conversations c WHERE c.user_id=u.id) AS conversations,
          (SELECT COUNT(*) FROM usage_events e WHERE e.user_id=u.id AND e.created_at >= ?) AS requestsThisMonth,
          (SELECT COALESCE(SUM(e.estimated_cost_usd),0) FROM usage_events e WHERE e.user_id=u.id AND e.created_at >= ?) AS estimatedCostUsd,
          (SELECT COUNT(e.estimated_cost_usd) FROM usage_events e WHERE e.user_id=u.id AND e.created_at >= ?) AS pricedRequests
        FROM users u ORDER BY u.created_at DESC LIMIT 200
      `).bind(start, start, start).all()
    ]);
    return json({
      ok: true, admin: { email: user.email },
      totals: {
        users: Number(totals?.users || 0),
        conversations: Number(totals?.conversations || 0),
        requestsThisMonth: Number(totals?.requestsThisMonth || 0),
        estimatedCostUsd: Number(totals?.estimatedCostUsd || 0),
        pricedRequests: Number(totals?.pricedRequests || 0),
        tokensAvailable: Number((users.results || []).reduce((sum, row) => sum + Number(row.tokens || 0), 0))
      },
      plans: plans.results || [], users: users.results || [],
      usersLimited: (users.results || []).length >= 200, periodStart: start
    });
  }

  const tokenMatch = path.match(/^\/api\/admin\/users\/([a-f0-9-]+)\/tokens$/i);
  if (tokenMatch && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
    const delta = Number(body?.delta);
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 240) : "";
    if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1000000) {
      return json({ error: "delta must be a non-zero whole number between -1,000,000 and 1,000,000." }, 400);
    }
    if (delta < 0 && !reason) return json({ error: "Add a reason when removing tokens." }, 400);
    try {
      const changed = await env.DB.prepare(`
        UPDATE users SET token_balance = token_balance + ?
        WHERE id = ? AND token_balance + ? >= 0
        RETURNING id, email, token_balance AS tokens
      `).bind(delta, tokenMatch[1], delta).first();
      if (!changed) {
        const exists = await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(tokenMatch[1]).first();
        return exists ? json({ error: "Not enough tokens to remove that amount." }, 409) : json({ error: "User not found." }, 404);
      }
      await env.DB.prepare(`
        INSERT INTO admin_token_ledger (id,admin_email,user_id,delta,balance_after,reason)
        VALUES (?,?,?,?,?,?)
      `).bind(crypto.randomUUID(), String(user.email).toLowerCase(), changed.id, delta, Number(changed.tokens), reason).run();
      return json({ ok: true, user: changed, delta, reason });
    } catch (error) {
      return json({ error: "Token adjustment unavailable. Check that migration 0009_admin_tokens.sql has been applied. " + String(error?.message || error).slice(0, 140) }, 503);
    }
  }

  const analysisMatch = path.match(/^\/api\/admin\/users\/([a-f0-9-]+)\/analysis$/i);
  if (analysisMatch && request.method === "GET") {
    const id = analysisMatch[1];
    try {
      const [account, usage, modules, ledger, activity] = await Promise.all([
        env.DB.prepare(`
          SELECT u.id,u.email,u.display_name AS name,u.plan,u.token_balance AS tokens,u.created_at AS createdAt,
            (SELECT COUNT(*) FROM conversations c WHERE c.user_id=u.id) AS conversations,
            (SELECT COUNT(*) FROM usage_events e WHERE e.user_id=u.id AND e.created_at >= ?) AS requestsThisMonth,
            (SELECT MAX(e.created_at) FROM usage_events e WHERE e.user_id=u.id) AS lastAIActivity
          FROM users u WHERE u.id=?
        `).bind(start, id).first(),
        env.DB.prepare(`
          SELECT COUNT(*) AS totalRequests, COALESCE(SUM(input_characters),0) AS inputCharacters,
            COALESCE(SUM(image_count),0) AS images, COALESCE(SUM(estimated_cost_usd),0) AS estimatedCostUsd,
            COUNT(estimated_cost_usd) AS pricedRequests, MIN(created_at) AS firstActivity, MAX(created_at) AS lastActivity
          FROM usage_events WHERE user_id=? AND created_at >= ?
        `).bind(id, start).first(),
        env.DB.prepare(`
          SELECT module_id AS moduleId, COUNT(*) AS requests, COALESCE(SUM(image_count),0) AS images,
            COALESCE(SUM(estimated_cost_usd),0) AS estimatedCostUsd, COUNT(estimated_cost_usd) AS pricedRequests
          FROM usage_events WHERE user_id=? AND created_at >= ? GROUP BY module_id ORDER BY requests DESC
        `).bind(id, start).all(),
        env.DB.prepare(`
          SELECT delta,balance_after AS balanceAfter,reason,admin_email AS adminEmail,created_at AS createdAt
          FROM admin_token_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 30
        `).bind(id).all(),
        env.DB.prepare(`
          SELECT module_id AS moduleId,model_id AS modelId,input_characters AS inputCharacters,image_count AS images,
            estimated_cost_usd AS estimatedCostUsd,created_at AS createdAt
          FROM usage_events WHERE user_id=? ORDER BY created_at DESC LIMIT 20
        `).bind(id).all()
      ]);
      if (!account) return json({ error: "User not found." }, 404);
      return json({ ok: true, account, usage: usage || {}, modules: modules.results || [], tokenHistory: ledger.results || [], recentActivity: activity.results || [], periodStart: start });
    } catch (error) {
      return json({ error: "User analysis unavailable. Check that migrations and usage tables are applied. " + String(error?.message || error).slice(0, 140) }, 503);
    }
  }

  return json({ error: "Not found." }, 404);
}
