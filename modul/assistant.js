/**
 * Open Source AI Me — modular assistant adapter.
 * The browser sends prompts to a same-origin backend endpoint (/api/chat).
 * Configure the model provider and keep all provider secrets on the server.
 */
export const name = "Open Source AI";
export const version = "0.2.0";
export const mode = "api";

const API_PATH = "/api/chat";

export async function respond(prompt) {
  const text = String(prompt ?? "").trim();
  if (!text) return "Nhập câu hỏi trước nhé.";
  if (text.length > 20000) return "Tin nhắn quá dài (tối đa 20.000 ký tự). Hãy chia thành vài phần.";

  if (typeof fetch !== "function" || typeof location === "undefined") {
    return "Môi trường này chưa hỗ trợ gọi API. Hãy chạy module trong trình duyệt và cấu hình backend.";
  }

  let response;
  try {
    response = await fetch(API_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ message: text })
    });
  } catch {
    return "Chưa kết nối được AI backend. Cần triển khai endpoint POST /api/chat trên Cloudflare Worker rồi thử lại.";
  }

  if (response.status === 404 || response.status === 405) {
    return "Modul đã hoạt động, nhưng Worker chưa có endpoint POST /api/chat. Cần nối backend với một model AI để nhận câu trả lời thực sự.";
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return "AI backend trả về lỗi HTTP " + response.status + (detail ? ": " + detail.slice(0, 300) : "") + ". Kiểm tra cấu hình Worker và model.";
  }

  let data;
  try { data = await response.json(); }
  catch { return "AI backend không trả JSON hợp lệ. Kiểm tra response của /api/chat."; }

  const answer = data.reply ?? data.response ?? data.answer ?? data.output_text;
  if (typeof answer === "string" && answer.trim()) return answer;
  if (data.error) return "AI backend: " + String(data.error);
  return "AI backend đã phản hồi nhưng không có trường reply/response/answer.";
}
