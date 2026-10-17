/** Browser adapter for the unified Grot-O1 AI engine. */
export const id = "grot-o1";
export const name = "Grot-O1 · Unified AI Engine";
export const version = "1.0.0";
export const mode = "api";
export const capabilities = ["chat","coding","security-analysis","study-tutor","vision","agentic-research","account-history","saved-memories","conversation-continuity"];
export let currentConversationId = null;
export function setConversation(id) { currentConversationId = id || null; }
export function clearMemory() { currentConversationId = null; }
export function getMemorySize() { return currentConversationId ? 1 : 0; }
export async function respond(prompt, conversationId = currentConversationId, images = []) {
  const message = String(prompt ?? "").trim();
  if (!message && !(Array.isArray(images) && images.length)) throw new Error("Write a message or attach an image first.");
  if (message.length > 20000) throw new Error("Message is too long (20,000 characters max).");
  const response = await fetch(new URL("/api/chat", globalThis.location.origin), {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      message: message || "Inspect the attached image and explain what is visible.",
      conversationId: conversationId || undefined,
      images: Array.isArray(images) ? images.slice(0, 3) : [],
      moduleId: id
    })
  });
  let data;
  try { data = await response.json(); } catch { throw new Error("Grot-O1 backend returned invalid JSON."); }
  if (data.conversationId) currentConversationId = data.conversationId;
  if (!response.ok) throw new Error(data?.error || ("Grot-O1 backend HTTP " + response.status));
  const answer = data?.reply ?? data?.response ?? data?.answer;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("Grot-O1 returned an empty response.");
  return answer;
}
