/**
 * Open Source AI Me — dedicated AI engine module.
 * Keeps conversation memory in this module and delegates inference to the
 * same-origin Worker endpoint. Provider secrets never enter browser code.
 */
export const name = "Open Source AI Engine";
export const version = "0.3.0";
export const mode = "api";
export const capabilities = ["chat", "conversation-memory", "code-help"];

const API_PATH = "/api/chat";
const MAX_INPUT = 20000;
const MAX_HISTORY = 12;
const history = [];

export function clearMemory() {
  history.length = 0;
}

export function getMemorySize() {
  return history.length;
}

export async function respond(prompt) {
  const text = String(prompt ?? "").trim();
  if (!text) return "Nhập câu hỏi trước nhé.";
  if (text.length > MAX_INPUT) {
    return "Tin nhắn quá dài (tối đa 20.000 ký tự). Hãy chia thành vài phần.";
  }
  if (typeof fetch !== "function") {
    return "Môi trường này chưa hỗ trợ gọi API.";
  }

  const messages = [
    ...history.slice(-MAX_HISTORY),
    { role: "user", content: text }
  ];

  let response;
  try {
    response = await fetch(API_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ message: text, messages })
    });
  } catch {
    return "Chưa kết nối được AI backend. Hãy kiểm tra Worker và endpoint POST /api/chat.";
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return "AI backend không trả JSON hợp lệ. Kiểm tra response của /api/chat.";
  }

  if (!response.ok) {
    const detail = data?.error ? String(data.error) : "HTTP " + response.status;
    return "AI backend gặp lỗi: " + detail.slice(0, 300);
  }

  const answer = data?.reply ?? data?.response ?? data?.answer ?? data?.output_text;
  if (typeof answer !== "string" || !answer.trim()) {
    return "AI backend đã phản hồi nhưng không có câu trả lời hợp lệ.";
  }

  history.push({ role: "user", content: text });
  history.push({ role: "assistant", content: answer });
  if (history.length > MAX_HISTORY * 2) history.splice(0, history.length - MAX_HISTORY * 2);
  return answer;
}
