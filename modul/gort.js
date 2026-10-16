/** Browser adapter for the standalone Gort module. All inference and private memory stay on the server. */
export const id = "gort";
export const name = "Gort · Standalone Coding AI";
export const version = "1.0.0";
export const mode = "api";
export const capabilities = ["chat","account-history","multi-language-code","code-revision","self-hosted-inference","private-gort-memory","web-research","voice-input","spoken-replies","conversation-continuity"];
export let currentConversationId = null;
export function setConversation(id) { currentConversationId = id || null; }
export function clearMemory() { currentConversationId = null; }
export function getMemorySize() { return currentConversationId ? 1 : 0; }
export async function respond(prompt, conversationId = currentConversationId, images = []) {
  const message = String(prompt ?? "").trim();
  if (!message) throw new Error("Enter a message first.");
  if (message.length > 20000) throw new Error("Message is too long (20,000 characters max).");
  const response = await fetch(new URL("/api/chat", globalThis.location.origin), {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ message, conversationId: conversationId || undefined, images: Array.isArray(images) ? images.slice(0, 3) : [], moduleId: id })
  });
  let data;
  try { data = await response.json(); } catch { throw new Error("Gort backend returned invalid JSON."); }
  if (data.conversationId) currentConversationId = data.conversationId;
  if (!response.ok) throw new Error(data?.error || ("Gort backend HTTP " + response.status));
  const answer = data?.reply;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("Gort returned an empty response.");
  return answer;
}
