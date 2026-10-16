const json = (data, status = 200) => Response.json(data, { status });
const makeId = () => crypto.randomUUID();
export async function handleMemories(request, env, user, url) {
  if (!env.DB) return json({ error: "Database binding DB is missing." }, 503);
  if (url.pathname === "/api/memories" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id,content,created_at AS createdAt,updated_at AS updatedAt FROM memories WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(user.id).all();
    return json({ memories: rows.results || [] });
  }
  if (url.pathname === "/api/memories" && request.method === "POST") {
    let body; try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!content) return json({ error: "Memory content is required." }, 400);
    if (content.length > 2000) return json({ error: "Memory must be 2,000 characters or less." }, 413);
    const id = makeId();
    await env.DB.prepare("INSERT INTO memories (id,user_id,content) VALUES (?,?,?)").bind(id,user.id,content).run();
    return json({ memory: { id, content } }, 201);
  }
  const match = url.pathname.match(/^\/api\/memories\/([a-f0-9-]+)$/i);
  if (match && request.method === "PUT") {
    let body; try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!content) return json({ error: "Memory content is required." }, 400);
    if (content.length > 2000) return json({ error: "Memory must be 2,000 characters or less." }, 413);
    const result = await env.DB.prepare("UPDATE memories SET content=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=?").bind(content,match[1],user.id).run();
    return (result.meta?.changes || 0) > 0 ? json({ memory: { id: match[1], content } }) : json({ error: "Memory not found." }, 404);
  }
  if (match && request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM memories WHERE id=? AND user_id=?").bind(match[1],user.id).run();
    return (result.meta?.changes || 0) > 0 ? json({ ok: true }) : json({ error: "Memory not found." }, 404);
  }
  return json({ error: "Not found." }, 404);
}
