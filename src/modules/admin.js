const json = (data, status = 200) => Response.json(data, { status });

export function isAdminUser(user, env) {
  const configuredEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  return Boolean(configuredEmail && user?.email && String(user.email).trim().toLowerCase() === configuredEmail);
}

export async function handleAdminApi(request, env, user, url) {
  if (!isAdminUser(user, env)) return json({ error: "Not found." }, 404);
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  if (url.pathname !== "/api/admin/overview" || request.method !== "GET") {
    return json({ error: "Not found." }, 404);
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const start = monthStart.toISOString();

  const [totals, plans, users] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) AS users,
        (SELECT COUNT(*) FROM conversations) AS conversations,
        (SELECT COUNT(*) FROM usage_events WHERE created_at >= ?) AS requestsThisMonth
      FROM users
    `).bind(start).first(),
    env.DB.prepare("SELECT plan, COUNT(*) AS count FROM users GROUP BY plan ORDER BY plan").all(),
    env.DB.prepare(`
      SELECT u.id, u.email, u.display_name AS name, u.plan, u.created_at AS createdAt,
        (SELECT COUNT(*) FROM conversations c WHERE c.user_id=u.id) AS conversations,
        (SELECT COUNT(*) FROM usage_events e WHERE e.user_id=u.id AND e.created_at >= ?) AS requestsThisMonth
      FROM users u
      ORDER BY u.created_at DESC
      LIMIT 200
    `).bind(start).all()
  ]);

  return json({
    ok: true,
    admin: { email: user.email },
    totals: {
      users: Number(totals?.users || 0),
      conversations: Number(totals?.conversations || 0),
      requestsThisMonth: Number(totals?.requestsThisMonth || 0)
    },
    plans: plans.results || [],
    users: users.results || [],
    usersLimited: (users.results || []).length >= 200,
    periodStart: start
  });
}
