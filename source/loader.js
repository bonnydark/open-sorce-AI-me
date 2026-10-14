/**
 * GitHub-hosted module loader. Modules execute in the browser with the current
 * user's permissions; only load code from repositories and branches you trust.
 */
export async function loadModule(options = {}) {
  const rawBase = options.rawBase || "https://raw.githubusercontent.com/bonnydark/open-sorce-AI-me/main/";
  const manifestResponse = await fetch(rawBase + "source/manifest.json", { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error("Manifest request failed: HTTP " + manifestResponse.status);
  const manifest = await manifestResponse.json();
  const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
  const requestedId = String(options.moduleId || manifest.defaultModule || "ai-engine");
  const selected = modules.find(item => item && item.id === requestedId) || modules.find(item => item && item.id === manifest.defaultModule);
  const entry = selected?.entry || manifest.entry;
  if (!manifest || typeof entry !== "string" || !/^[a-zA-Z0-9_./-]+\.js$/.test(entry) || entry.includes("..")) {
    throw new Error("Invalid module entry in manifest");
  }
  const moduleResponse = await fetch(rawBase + entry, { cache: "no-store" });
  if (!moduleResponse.ok) throw new Error("Module request failed: HTTP " + moduleResponse.status);
  const source = await moduleResponse.text();
  const moduleUrl = URL.createObjectURL(new Blob([source + "\n//# sourceURL=" + entry], { type: "text/javascript" }));
  try {
    const loaded = await import(moduleUrl);
    if (typeof loaded.respond !== "function") throw new Error("Module must export an async respond(prompt) function");
    return {
      ...loaded,
      get currentConversationId() { return loaded.currentConversationId || null; },
      id: loaded.id || selected?.id || requestedId,
      name: loaded.name || selected?.name || manifest.name,
      version: loaded.version || manifest.version
    };
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}
