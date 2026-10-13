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
    return json({ ok: true, token, url: new URL("/share/" + token, request.url).toString() }, 201);
  }
  if (request.method === "DELETE") {
    await env.DB.prepare("UPDATE chat_shares SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE conversation_id=? AND user_id=? AND revoked_at IS NULL").bind(conversationId,user.id).run();
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, 405);
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