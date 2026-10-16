const json = (data, status = 200) => Response.json(data, { status });
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
const hash = async value => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
};

export async function handleShareOwner(request, env, user, url) {
  const match = url.pathname.match(/^\/api\/chats\/([a-f0-9-]+)\/share$/i);
  if (!match) return json({ error: "Not found." }, 404);
  const conversationId = match[1];
  const chat = await env.DB.prepare("SELECT id FROM conversations WHERE id=? AND user_id=?").bind(conversationId, user.id).first();
  if (!chat) return json({ error: "Chat not found." }, 404);
  if (request.method === "POST") {
    const existing = await env.DB.prepare("SELECT id FROM chat_shares WHERE conversation_id=? AND user_id=? AND revoked_at IS NULL LIMIT 1").bind(conversationId,user.id).first();
    if (existing) {
      // Return a new secret only when a new link is created; existing links cannot be recovered from hashes.
      await env.DB.prepare("UPDATE chat_shares SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE conversation_id=? AND user_id=? AND revoked_at IS NULL").bind(conversationId,user.id).run();
    }
    const token = randomToken();
    await env.DB.prepare("INSERT INTO chat_shares (id,conversation_id,user_id,token_hash) VALUES (?,?,?,?)").bind(crypto.randomUUID(),conversationId,user.id,await hash(token)).run();
    return json({ ok: true, token, url: new URL("/chat/share/" + token, request.url).toString() }, 201);
  }
  if (request.method === "DELETE") {
    await env.DB.prepare("UPDATE chat_shares SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE conversation_id=? AND user_id=? AND revoked_at IS NULL").bind(conversationId,user.id).run();
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, 405);
}


export async function getSharedFile(request, env, url) {
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  const match = url.pathname.match(/^\/api\/shared\/([a-f0-9]{64})\/files\/([a-f0-9-]+)\/view$/i);
  if (!match) return json({ error: "Shared file not found." }, 404);
  const [, token, fileId] = match;
  const share = await env.DB.prepare("SELECT conversation_id AS conversationId, user_id AS userId FROM chat_shares WHERE token_hash=? AND revoked_at IS NULL").bind(await hash(token)).first();
  if (!share) return json({ error: "This share link is invalid or has been revoked." }, 404);
  // Only serve image IDs explicitly referenced in messages in this shared conversation.
  const marker = "[[OSAI_IMAGE:" + fileId + "|";
  const referenced = await env.DB.prepare("SELECT id FROM messages WHERE conversation_id=? AND instr(content, ?) > 0 LIMIT 1").bind(share.conversationId, marker).first();
  if (!referenced) return json({ error: "This image is not part of the shared conversation." }, 404);
  const file = await env.DB.prepare("SELECT filename,content_type AS contentType,content FROM user_files WHERE id=? AND user_id=?").bind(fileId, share.userId).first();
  if (!file || !String(file.contentType || "").startsWith("image/")) return json({ error: "Shared image not found." }, 404);
  const encoded = String(file.content || "").match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i);
  if (!encoded) return json({ error: "Stored image data is invalid." }, 500);
  const binary = atob(encoded[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Response(bytes, { status: 200, headers: {
    "Content-Type": file.contentType,
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store"
  }});
}

export async function getSharedChat(request, env, url) {
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  const token = url.pathname.split("/").filter(Boolean).pop() || "";
  if (!/^[a-f0-9]{64}$/i.test(token)) return json({ error: "Shared conversation not found." }, 404);
  const share = await env.DB.prepare("SELECT conversation_id FROM chat_shares WHERE token_hash=? AND revoked_at IS NULL").bind(await hash(token)).first();
  if (!share) return json({ error: "This share link is invalid or has been revoked." }, 404);
  const chat = await env.DB.prepare("SELECT id,title,created_at AS createdAt,updated_at AS updatedAt FROM conversations WHERE id=?").bind(share.conversation_id).first();
  if (!chat) return json({ error: "Shared conversation not found." }, 404);
  const rows = await env.DB.prepare("SELECT role,content,created_at AS createdAt FROM messages WHERE conversation_id=? ORDER BY created_at,id").bind(chat.id).all();
  return json({ chat: { ...chat, messages: rows.results || [] }, readOnly: true });
}