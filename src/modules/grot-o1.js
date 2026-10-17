/**
 * Grot-O1 is the single user-facing GortGPT AI engine.
 * Specialist prompts, vision, and agentic research are internal capabilities,
 * not separate selectable AI modules. Existing specialist files remain internal
 * implementation details so they can be improved independently.
 */
import { generateReply } from "./ai-engine.js";
import { generateCodeCopilotReply } from "./code-copilot.js";
import { generateSpecialistReply } from "./specialists.js";
import { runAgent } from "./agent.js";

export const GROT_O1_VERSION = "1.0.0";

function shouldAutoResearch(conversation, settings) {
  if (settings.researchMode === "off") return false;
  if (settings.agentMode === true) return true;
  const lastUser = [...(Array.isArray(conversation) ? conversation : [])].reverse().find(item => item?.role === "user" && typeof item.content === "string");
  const text = String(lastUser?.content || "").toLowerCase();
  const asksForResearch = /\b(research|sources?|citations?|references?|compare (?:the )?sources|fact.?check|verify (?:this|these)|look up|search (?:the )?web|latest|current|today|recent|news|202[0-9])\b|tìm nguồn|trích dẫn|dẫn nguồn|đối chiếu|kiểm chứng|tra cứu|tìm trên mạng|tìm trên web|mới nhất|hôm nay|hiện tại|tin mới|nguồn uy tín|nghiên cứu/i.test(text);
  return asksForResearch && settings.researchMode !== "off";
}

export async function generateGrotO1Reply(env, conversation, settings = {}, images = []) {
  if (!env?.AI) throw new Error("Cloudflare Workers AI binding AI is missing.");
  const history = Array.isArray(conversation) ? conversation : [];
  const imageList = Array.isArray(images) ? images.filter(item => typeof item === "string").slice(0, 3) : [];

  // Vision is automatic: attaching an image is enough; no separate module switch.
  if (imageList.length) {
    return generateReply(env.AI, history, {
      ...settings,
      activeModule: "ai-engine",
      specialistMode: settings.specialistMode === true,
      visionMode: true
    }, imageList);
  }

  // Agentic research is a capability inside Grot-O1, controlled by one setting.
  if (shouldAutoResearch(history, settings)) {
    const result = await runAgent(env, history, { maxSteps: 4, forceResearch: true });
    return { reply: result.reply, modelCalls: result.modelCalls, route: "agent" };
  }

  // Optional task profiles tune Grot-O1 without creating more top-level modules.
  if (settings.specialistMode === true && settings.workspaceProfile === "developer") {
    return { reply: await generateCodeCopilotReply(env.AI, history, settings), modelCalls: 1, route: "developer" };
  }
  if (settings.specialistMode === true && ["bug-bounty", "student"].includes(settings.workspaceProfile)) {
    const moduleId = settings.workspaceProfile === "bug-bounty" ? "security-analyst" : "study-tutor";
    return { reply: await generateSpecialistReply(env.AI, moduleId, history, settings), modelCalls: 1, route: moduleId };
  }

  return {
    reply: await generateReply(env.AI, history, { ...settings, activeModule: "ai-engine", visionMode: false }, []),
    modelCalls: 1,
    route: "general"
  };
}
