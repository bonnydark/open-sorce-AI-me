/**
 * Open Source AI Me — Training Lab module.
 *
 * This module prepares reviewed examples for fine-tuning a compatible model.
 * It does NOT train model weights inside a browser or Cloudflare Worker.
 * Exported JSONL can be used by a separate training runtime that supports
 * the selected model and fine-tuning method.
 */
export const name = "AI Training Lab";
export const version = "0.1.0";
export const mode = "dataset";
export const capabilities = ["example-review", "jsonl-import-export", "dataset-validation"];

const STORAGE_KEY = "osai-me-training-lab-v1";
const MAX_EXAMPLES = 5000;
const MAX_TEXT = 20000;

function cleanText(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

function normalizeExample(value) {
  if (!value || typeof value !== "object") throw new Error("Example must be an object.");
  const prompt = cleanText(value.prompt ?? value.input);
  const answer = cleanText(value.answer ?? value.output);
  if (!prompt || !answer) throw new Error("Each example needs a non-empty prompt and answer.");
  return {
    prompt,
    answer,
    category: cleanText(value.category) || "general",
    reviewed: value.reviewed === true,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString()
  };
}

function readStore() {
  try {
    if (typeof localStorage === "undefined") return [];
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX_EXAMPLES).map(normalizeExample) : [];
  } catch {
    return [];
  }
}

function writeStore(items) {
  if (typeof localStorage === "undefined") {
    throw new Error("Persistent browser storage is unavailable in this environment.");
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_EXAMPLES)));
}

export function listExamples() {
  return readStore();
}

export function addExample(value) {
  const items = readStore();
  if (items.length >= MAX_EXAMPLES) throw new Error("Dataset limit reached. Export or remove examples first.");
  const example = normalizeExample(value);
  items.push(example);
  writeStore(items);
  return { ...example, index: items.length - 1 };
}

export function updateExample(index, patch) {
  const items = readStore();
  if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new Error("Example index not found.");
  items[index] = normalizeExample({ ...items[index], ...patch });
  writeStore(items);
  return items[index];
}

export function removeExample(index) {
  const items = readStore();
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return false;
  items.splice(index, 1);
  writeStore(items);
  return true;
}

export function clearExamples() {
  writeStore([]);
}

export function validateDataset(input = readStore()) {
  const issues = [];
  if (!Array.isArray(input)) return { valid: false, count: 0, reviewed: 0, issues: ["Dataset must be a JSON array."] };
  if (input.length === 0) issues.push("Dataset is empty.");
  if (input.length > MAX_EXAMPLES) issues.push("Dataset exceeds the maximum of " + MAX_EXAMPLES + " examples.");
  let reviewed = 0;
  input.forEach((item, index) => {
    try {
      normalizeExample(item);
      if (item.reviewed === true) reviewed++;
    } catch (error) {
      issues.push("Example " + (index + 1) + ": " + error.message);
    }
  });
  if (reviewed < input.length) issues.push((input.length - reviewed) + " example(s) still need human review.");
  return { valid: issues.length === 0, count: input.length, reviewed, issues };
}

export function exportJSONL({ reviewedOnly = true } = {}) {
  const items = readStore().filter(item => !reviewedOnly || item.reviewed);
  return items.map(item => JSON.stringify({
    messages: [
      { role: "user", content: item.prompt },
      { role: "assistant", content: item.answer }
    ]
  })).join("\n");
}

export function importJSONL(source) {
  if (typeof source !== "string" || !source.trim()) throw new Error("Paste JSONL content first.");
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length > MAX_EXAMPLES) throw new Error("Import exceeds the maximum of " + MAX_EXAMPLES + " examples.");
  const imported = lines.map((line, index) => {
    let parsed;
    try { parsed = JSON.parse(line); }
    catch { throw new Error("Invalid JSON on line " + (index + 1) + "."); }
    const messages = parsed.messages;
    if (Array.isArray(messages)) {
      const user = [...messages].reverse().find(item => item?.role === "user");
      const assistant = [...messages].reverse().find(item => item?.role === "assistant");
      return normalizeExample({ prompt: user?.content, answer: assistant?.content, reviewed: false });
    }
    return normalizeExample({ prompt: parsed.prompt ?? parsed.input, answer: parsed.answer ?? parsed.output, reviewed: false });
  });
  const current = readStore();
  if (current.length + imported.length > MAX_EXAMPLES) throw new Error("Import would exceed the dataset limit.");
  writeStore([...current, ...imported]);
  return { imported: imported.length, total: current.length + imported.length };
}

/**
 * A local quality checklist only; it does not claim to measure model accuracy.
 * Human review is required before an example is marked ready for training.
 */
export function reviewChecklist(example) {
  const item = normalizeExample(example);
  const checks = {
    promptPresent: Boolean(item.prompt),
    answerPresent: Boolean(item.answer),
    answerSpecific: item.answer.length >= 12,
    noPlaceholder: !/\b(TODO|PLACEHOLDER|INSERT HERE)\b/i.test(item.answer)
  };
  return { checks, suggestedReady: Object.values(checks).every(Boolean) };
}
