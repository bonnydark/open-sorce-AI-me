const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
const allowedExt = /\.(txt|md|markdown|csv|json|js|mjs|ts|tsx|jsx|html|css|xml|svg|py|sh|sql|yaml|yml|toml|log|diff|patch)$/i;
const safeName = value => String(value || "file.txt").replace(/[\\/\0-\x1f\x7f]/g, "_").slice(0, 120) || "file.txt";
export async function handleFiles(request, env, user, url) {
  const path = url.pathname;
  if (path === "/api/files" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id,filename,content_type AS contentType,length(content) AS size,created_at AS createdAt FROM user_files WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(user.id).all();
    return json({ files: rows.results || [] });
  }
  if (path === "/api/files" && request.method === "POST") {
    let body; try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
    const filename = safeName(body?.filename);
    const content = typeof body?.content === "string" ? body.content : "";
    if (!allowedExt.test(filename)) return json({ error: "Only text/code file types are supported (txt, md, csv, json, js, html, css, py, sql, and similar)." }, 415);
    if (content.length > 500000) return json({ error: "File is too large. Maximum is 500 KB of text." }, 413);
    const contentType = "text/plain; charset=utf-8";
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO user_files (id,user_id,filename,content_type,content) VALUES (?,?,?,?,?)").bind(id,user.id,filename,contentType,content).run();
    return json({ file: { id, filename, contentType, size: content.length, url: "/api/files/" + id } }, 201);
  }
  const match = path.match(/^\/api\/files\/([a-f0-9-]+)$/i);
  if (match && request.method === "GET") {
    const file = await env.DB.prepare("SELECT filename,content_type AS contentType,content FROM user_files WHERE id=? AND user_id=?").bind(match[1],user.id).first();
    if (!file) return json({ error: "File not found." }, 404);
    const filename = file.filename.replace(/["\\\r\n]/g, "_");
    return new Response(file.content, { status: 200, headers: { "Content-Type": file.contentType || "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="' + filename + '"', "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
  }
  if (match && request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM user_files WHERE id=? AND user_id=?").bind(match[1],user.id).run();
    return (result.meta?.changes || 0) ? json({ ok: true }) : json({ error: "File not found." },404);
  }
  return json({ error: "Not found." },404);
}