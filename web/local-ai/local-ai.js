const $ = (id) => document.getElementById(id);
let engine = null;
let loadingController = null;
let busy = false;
const status = (message, type = "") => { $("status").textContent = message; $("status").className = "status " + type; };
const progress = (value) => { $("progress").style.width = Math.max(0, Math.min(100, Number(value) || 0)) + "%"; };
function addMessage(role, text) {
  const node = document.createElement("div");
  node.className = "msg " + role;
  node.textContent = text;
  $("messages").appendChild(node);
  node.scrollIntoView({ block: "end", behavior: "smooth" });
  return node;
}
function setReady(ready) {
  $("prompt").disabled = !ready || busy;
  $("send").disabled = !ready || busy;
  $("load").disabled = busy || Boolean(engine);
}
$("load").addEventListener("click", async () => {
  if (busy || engine) return;
  if (!("gpu" in navigator)) {
    status("Trình duyệt này không phát hiện WebGPU. Hãy thử Chrome/Edge mới nhất và cập nhật driver đồ họa.", "warn");
    return;
  }
  busy = true; $("load").disabled = true; $("stop").disabled = false;
  loadingController = new AbortController();
  try {
    status("Đang tải engine WebLLM…");
    const { CreateMLCEngine } = await import("https://esm.run/@mlc-ai/web-llm");
    const model = $("model").value;
    engine = await CreateMLCEngine(model, {
      initProgressCallback: (report) => {
        if (report && typeof report.progress === "number") progress(report.progress * 100);
        status(report?.text || "Đang khởi tạo mô hình…");
      },
      appConfig: undefined
    });
    status("Mô hình đã sẵn sàng. Tin nhắn được xử lý trong trình duyệt.", "ok");
    progress(100);
    setReady(true);
  } catch (error) {
    engine = null;
    status("Không khởi động được model: " + (error?.message || String(error)) + ". Kiểm tra WebGPU, bộ nhớ và kết nối tải model rồi thử lại.", "warn");
    $("load").disabled = false;
  } finally {
    busy = false; loadingController = null; $("stop").disabled = true;
    if (engine) setReady(true);
  }
});
$("stop").addEventListener("click", () => {
  if (loadingController) loadingController.abort();
  status("Yêu cầu dừng đã gửi. Nếu tải model không dừng ngay, hãy tải lại trang.");
});
$("model").addEventListener("change", () => {
  if (engine) status("Đổi model sẽ cần tải lại trang và khởi tạo lại mô hình.");
});
$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = $("prompt").value.trim();
  if (!prompt || !engine || busy) return;
  addMessage("user", prompt);
  $("prompt").value = "";
  const answerNode = addMessage("assistant", "Đang suy luận trên thiết bị…");
  busy = true; setReady(false);
  try {
    const history = Array.from($("messages").querySelectorAll(".msg")).slice(-13, -1).map((node) => ({
      role: node.classList.contains("user") ? "user" : "assistant",
      content: node.textContent
    })).filter((item) => item.content && item.content !== "Đang suy luận trên thiết bị…");
    const messages = [{ role: "system", content: "Bạn là GortGPT Local AI, trợ lý hữu ích. Trả lời bằng ngôn ngữ người dùng đang sử dụng. Bạn đang chạy trong trình duyệt, không có quyền truy cập web hoặc công cụ bên ngoài trừ khi được cung cấp trong prompt." }, ...history, { role: "user", content: prompt }];
    const result = await engine.chat.completions.create({ messages, temperature: 0.7, max_tokens: 700 });
    answerNode.textContent = result.choices?.[0]?.message?.content?.trim() || "(Model không trả về nội dung.)";
  } catch (error) {
    answerNode.textContent = "Lỗi suy luận: " + (error?.message || String(error));
  } finally {
    busy = false; setReady(Boolean(engine)); $("prompt").focus();
  }
});
