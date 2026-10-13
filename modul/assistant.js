/**
 * Open Source AI Me — starter assistant module.
 * This is a lightweight demo, not a trained language model.
 * Replace or extend respond() to connect to your own secure backend.
 */
export const name = "Open Source Assistant";
export const version = "0.1.0";

export async function respond(prompt) {
  const text = String(prompt || "").trim();
  const q = text.toLowerCase();
  if (!text) return "Write a message and I'll try to help.";
  if (/^(hi|hello|hey|xin chào|chào bạn|chao)$/.test(q)) {
    return "Hello! 👋 I'm the Open Source AI Me starter module. What would you like to build?";
  }
  if (q.includes("who are you") || q.includes("bạn là ai") || q.includes("ban la ai")) {
    return "I'm Open Source AI Me, a modular assistant demo loaded from your GitHub repository. I'm a starter module, not a trained foundation model yet.";
  }
  if (q.includes("how") && (q.includes("work") || q.includes("load"))) {
    return "The web app loads source/loader.js, reads source/manifest.json, fetches the module in modul/, then calls its exported respond(prompt) function. Publish a new trusted module version to update the behavior.";
  }
  if (q.includes("github")) {
    return "This project is stored at https://github.com/bonnydark/open-sorce-AI-me. The web UI and source loader are separated from the assistant module so you can replace the module independently.";
  }
  if (q.includes("api key") || q.includes("apikey") || q.includes("api khóa")) {
    return "Keep AI provider API keys on a backend such as a Cloudflare Worker. Never paste secret keys into web/index.html or a public GitHub repository.";
  }
  return "I received: “" + text + "”\n\nThis starter uses simple local demo logic, so it doesn't yet have the reasoning ability of a full AI model. Next step: connect a model through a backend API, then keep this module as the swappable interface.";
}