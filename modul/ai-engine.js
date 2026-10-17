/**
 * Browser-side AI module adapter.
 * Authentication and durable chat memory live in the Worker/D1 backend.
 * This module only calls the same-origin API; it contains no model secrets.
 */
export const id = "ai-engine";
export const name = "GortGPT Core · Self-hosted AI";
export const version = "0.7.0";
export const mode = "api";
export const capabilities = ["chat", "account-history", "code-help", "read-only-public-web-fetch", "file-upload", "file-download", "read-only-sharing", "saved-memories", "voice-input", "spoken-replies", "conversation-continuity"];
export let currentConversationId = null;

export function setConversation(id) {
  currentConversationId = id || null;
}
export function clearMemory() {
  // Chat history is persisted server-side. This clears only the selected chat.
  currentConversationId = null;
}
export function getMemorySize() {
  return currentConversationId ? 1 : 0;
}
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
  try { data = await response.json(); }
  catch { throw new Error("The AI backend returned invalid JSON."); }
  if (data.conversationId) currentConversationId = data.conversationId;
  if (!response.ok) throw new Error(data?.error || ("AI backend HTTP " + response.status));
  const answer = data?.reply ?? data?.response ?? data?.answer ?? data?.output_text;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("AI backend returned an empty response.");
  return answer;
}
