const json = (data, status = 200) => Response.json(data, { status });
const id = () => crypto.randomUUID();
const titleFrom = text => String(text ?? "New chat").trim().replace(/\s+/g, " ").slice(0, 64) || "New chat";

// Recover safely when the auth tables exist but chat migrations were not applied.
let chatSchemaReady = null;
async function ensureChatSchema(db) {
  if (!chatSchemaReady) {
    chatSchemaReady = (async () => {
      await db.prepare(`CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT 'New chat',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`).run();
      await db.prepare("CREATE INDEX IF NOT EXISTS conversations_user_updated_idx ON conversations(user_id, updated_at DESC)").run();
      await db.prepare(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`).run();
      await db.prepare("CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id, created_at, id)").run();
    })().catch(error => { chatSchemaReady = null; throw error; });
  }
  return chatSchemaReady;
}
export async function ownsConversation(db, conversationId, userId) {
  await ensureChatSchema(db);
  return db.prepare("SELECT id,title FROM conversations WHERE id=? AND user_id=?").bind(conversationId, userId).first();
}
export async function listChats(db, userId) {
  await ensureChatSchema(db);
  const result = await db.prepare("SELECT id,title,created_at AS createdAt,updated_at AS updatedAt FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT 100")
    .bind(userId).all();
  return result.results || [];
}
export async function createChat(db, userId, title = "New chat") {
  await ensureChatSchema(db);
  const chatId = id();
  await db.prepare("INSERT INTO conversations (id,user_id,title) VALUES (?,?,?)").bind(chatId, userId, titleFrom(title)).run();
  return { id: chatId, title: titleFrom(title) };
}
export async function readChat(db, userId, conversationId) {
  const chat = await ownsConversation(db, conversationId, userId);
  if (!chat) return null;
  const result = await db.prepare("SELECT id,role,content,created_at AS createdAt FROM messages WHERE conversation_id=? AND user_id=? ORDER BY created_at,id")
    .bind(conversationId, userId).all();
  return { ...chat, messages: result.results || [] };
}
export async function deleteChat(db, userId, conversationId) {
  const result = await db.prepare("DELETE FROM conversations WHERE id=? AND user_id=?").bind(conversationId, userId).run();
  return (result.meta?.changes || 0) > 0;
}
export async function appendMessage(db, userId, conversationId, role, content) {
  await ensureChatSchema(db);
  await db.prepare("INSERT INTO messages (id,conversation_id,user_id,role,content) VALUES (?,?,?,?,?)")
    .bind(id(), conversationId, userId, role, content).run();
  await db.prepare("UPDATE conversations SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=?")
    .bind(conversationId, userId).run();
}
export async function recentContext(db, userId, conversationId, limit = 12) {
  await ensureChatSchema(db);
  const result = await db.prepare("SELECT role,content FROM messages WHERE conversation_id=? AND user_id=? ORDER BY created_at DESC,id DESC LIMIT ?")
    .bind(conversationId, userId, limit).all();
  return (result.results || []).reverse().map(row => ({ role: row.role, content: row.content }));
}
export async function handleChats(request, env, url, user) {
  if (!env.DB) return json({ error: "Database is not configured. Bind D1 as DB and apply migrations." }, 503);
  const path = url.pathname;
  if (path === "/api/chats" && request.method === "GET") return json({ chats: await listChats(env.DB, user.id) });
  if (path === "/api/chats" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch {}
    return json({ chat: await createChat(env.DB, user.id, body?.title) }, 201);
  }
  const match = path.match(/^\/api\/chats\/([a-f0-9-]+)$/i);
  if (match && request.method === "GET") {
    const chat = await readChat(env.DB, user.id, match[1]);
    return chat ? json({ chat }) : json({ error: "Chat not found." }, 404);
  }
  if (match && request.method === "DELETE") {
    return await deleteChat(env.DB, user.id, match[1]) ? json({ ok: true }) : json({ error: "Chat not found." }, 404);
  }
  return json({ error: "Not found." }, 404);
}
