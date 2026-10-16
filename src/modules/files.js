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
    let filename = safeName(body?.filename);
    const content = typeof body?.content === "string" ? body.content : "";
    const isImage = body?.isImage === true;
    let contentType = "text/plain; charset=utf-8";
    if (isImage) {
      const mimeType = String(body?.mimeType || "").toLowerCase();
      const extensionsByMime = {
        "image/png": [".png"],
        "image/jpeg": [".jpg", ".jpeg"],
        "image/gif": [".gif"],
        "image/webp": [".webp"],
        "image/bmp": [".bmp"],
        "image/avif": [".avif"]
      };
      const expectedExtensions = extensionsByMime[mimeType];
      if (!expectedExtensions) return json({ error: "Unsupported image type. Use PNG, JPEG, GIF, WebP, BMP, or AVIF." }, 415);
      const lowerFilename = filename.toLowerCase();
      const hasKnownImageExtension = /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(filename);
      if (hasKnownImageExtension && !expectedExtensions.some(ext => lowerFilename.endsWith(ext))) {
        return json({ error: "Image filename extension does not match its MIME type." }, 415);
      }
      // Some devices provide a valid image MIME type but omit the filename extension.
      if (!hasKnownImageExtension) filename += expectedExtensions[0];
      if (!content.startsWith("data:" + mimeType + ";base64,")) return json({ error: "Image data is invalid." }, 400);
      if (content.length > 700000) return json({ error: "Image is too large. Maximum is 500 KB per image." }, 413);
      contentType = mimeType;
    } else {
      if (!allowedExt.test(filename)) return json({ error: "Only image or text/code file types are supported." }, 415);
      if (content.length > 500000) return json({ error: "File is too large. Maximum is 500 KB of text." }, 413);
    }
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO user_files (id,user_id,filename,content_type,content) VALUES (?,?,?,?,?)").bind(id,user.id,filename,contentType,content).run();
    return json({ file: { id, filename, contentType, size: content.length, url: "/api/files/" + id } }, 201);
  }
  const match = path.match(/^\/api\/files\/([a-f0-9-]+)(\/view)?$/i);
  if (match && request.method === "GET") {
    const file = await env.DB.prepare("SELECT filename,content_type AS contentType,content FROM user_files WHERE id=? AND user_id=?").bind(match[1],user.id).first();
    if (!file) return json({ error: "File not found." }, 404);
    const filename = file.filename.replace(/["\\\\\\r\\n]/g, "_");
    const isView = Boolean(match[2]) && String(file.contentType || "").startsWith("image/");
    let payload = file.content;
    if (String(file.contentType || "").startsWith("image/")) {
      const encoded = String(file.content || "").match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i);base64,([\\s\\S]+)$/i);
      if (!encoded) return json({ error: "Stored image data is invalid." }, 500);
      const binary = atob(encoded[1]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      payload = bytes;
    }
    return new Response(payload, { status: 200, headers: { "Content-Type": file.contentType || "text/plain; charset=utf-8", "Content-Disposition": isView ? "inline" : 'attachment; filename="' + filename + '"', "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  }
  if (match && request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM user_files WHERE id=? AND user_id=?").bind(match[1],user.id).run();
    return (result.meta?.changes || 0) ? json({ ok: true }) : json({ error: "File not found." },404);
  }
  return json({ error: "Not found." },404);
}