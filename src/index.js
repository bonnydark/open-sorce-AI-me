import { handleAuth, getSessionUser } from "./modules/auth.js";
import { generateReply } from "./modules/ai-engine.js";
import { handleChats, createChat, appendMessage, recentContext, ownsConversation } from "./modules/chat-store.js";
import { handleUserSettings, getUserSettings } from "./modules/user-settings.js";

const json = (data, status = 200) => Response.json(data, { status });
const isApi = pathname => pathname.startsWith("/api/");
function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = new Headers({ "Vary": "Origin" });
  if (origin && new URL(request.url).origin === origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
  }
  return headers;
}
function withCors(response, headers) {
  const merged = new Headers(response.headers);
  headers.forEach((value, key) => merged.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS" && isApi(url.pathname)) return new Response(null, { status: 204, headers: cors });
    try {
      let response;
      if (url.pathname === "/api/health" && request.method === "GET") {
        response = json({ ok: true, service: "open-source-ai-me", ai: Boolean(env.AI), database: Boolean(env.DB) });
      } else if (url.pathname.startsWith("/api/auth/")) {
        response = await handleAuth(request, env, url);
      } else if (url.pathname.startsWith("/api/")) {
        if (!env.DB) response = json({ error: "Database is not configured. Create a D1 database, bind it as DB, and apply migrations." }, 503);
        else {
          const user = await getSessionUser(request, env);
          if (!user) response = json({ error: "Sign in to access your chat history." }, 401);
          else if (url.pathname === "/api/settings") {
            response = await handleUserSettings(request, env, user);
          } else if (url.pathname === "/api/chats" || /^\/api\/chats\/[a-f0-9-]+$/i.test(url.pathname)) {
            response = await handleChats(request, env, url, user);
          } else if (url.pathname === "/api/chat" && request.method === "POST") {
            let body;
            try { body = await request.json(); } catch { response = json({ error: "Expected JSON." }, 400); }
            if (!response) {
              const message = typeof body?.message === "string" ? body.message.trim() : "";
              if (!message) response = json({ error: "Message is required." }, 400);
              else if (message.length > 20000) response = json({ error: "Message too long (20,000 characters maximum)." }, 413);
              else {
                let conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
                let chat = conversationId ? await ownsConversation(env.DB, conversationId, user.id) : null;
                if (conversationId && !chat) response = json({ error: "Chat not found." }, 404);
                else {
                  if (!conversationId) {
                    const created = await createChat(env.DB, user.id, message);
                    conversationId = created.id;
                    chat = created;
                  }
                  await appendMessage(env.DB, user.id, conversationId, "user", message);
                  try {
                    const context = await recentContext(env.DB, user.id, conversationId, 12);
                    const settings = await getUserSettings(env.DB, user.id);
                    const reply = await generateReply(env.AI, context, settings);
                    await appendMessage(env.DB, user.id, conversationId, "assistant", reply);
                    response = json({ reply, conversationId, title: chat.title });
                  } catch (error) {
                    response = json({ error: "AI engine error: " + String(error?.message || error).slice(0, 240), conversationId }, 502);
                  }
                }
              }
            }
          } else response = json({ error: "Not found." }, 404);
        }
      } else {
        return env.ASSETS.fetch(request);
      }
      return withCors(response, cors);
    } catch (error) {
      return withCors(json({ error: "Internal server error: " + String(error?.message || error).slice(0, 180) }, 500), cors);
    }
  }
};
