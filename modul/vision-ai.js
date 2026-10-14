/**
 * Vision AI module adapter.
 * Uses the private Worker API for model inference and account-scoped chat history.
 * Image inference is handled server-side by Cloudflare Workers AI's LLaVA model.
 */
export const id = "vision-ai";
export const name = "Vision AI · Image understanding";
export const version = "1.0.0";
export const mode = "api";
export const capabilities = ["chat", "image-understanding", "screenshot-analysis", "diagram-analysis", "visual-debugging", "account-history", "file-upload", "conversation-continuity"];
export let currentConversationId = null;

export function setConversation(id) {
  currentConversationId = id || null;
}
export function clearMemory() {
  currentConversationId = null;
}
export function getMemorySize() {
  return currentConversationId ? 1 : 0;
}
export async function respond(prompt, conversationId = currentConversationId, images = []) {
  const message = String(prompt ?? "").trim();
  if (!message && !(Array.isArray(images) && images.length)) throw new Error("Write a question or attach an image first.");
  if (message.length > 20000) throw new Error("Message is too long (20,000 characters max).");
  const response = await fetch(new URL("/api/chat", globalThis.location.origin), {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      message: message || "Please inspect the attached image(s), explain what is visible, and answer any question implied by the context.",
      conversationId: conversationId || undefined,
      images: Array.isArray(images) ? images.slice(0, 3) : [],
      moduleId: id
    })
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error("The AI backend returned invalid JSON."); }
  if (data.conversationId) currentConversationId = data.conversationId;
  if (!response.ok) throw new Error(data?.error || ("AI backend HTTP " + response.status));
  const answer = data?.reply ?? data?.response ?? data?.answer ?? data?.output_text;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("AI backend returned an empty response.");
  return answer;
}
