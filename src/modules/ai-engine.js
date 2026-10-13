const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SYSTEM_PROMPT = `You are Open Source AI Me, a helpful modular assistant. Be clear, practical, and useful for coding, analysis, writing, and creative tasks. Use the supplied conversation history for context. When writing code, use fenced code blocks and identify the language. Be honest about uncertainty and never claim you performed actions you did not perform. Do not provide instructions that meaningfully enable serious harm.`;

export async function generateReply(aiBinding, conversation) {
  if (!aiBinding) throw new Error("Cloudflare Workers AI binding AI is missing.");
  const result = await aiBinding.run(MODEL, {
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...conversation],
    max_tokens: 1800
  });
  const reply = result?.response ?? result?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) throw new Error("The model returned an empty response.");
  return reply.trim();
}
