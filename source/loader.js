/**
 * Small loader for modules published in this repository.
 * It loads the manifest and module source as JavaScript from the configured rawBase.
 * Only load code from repositories and branches you trust.
 */
export async function loadModule(options = {}) {
  const rawBase = options.rawBase || "https://raw.githubusercontent.com/bonnydark/open-sorce-AI-me/main/";
  const manifestResponse = await fetch(rawBase + "source/manifest.json", { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error("Manifest request failed: HTTP " + manifestResponse.status);
  const manifest = await manifestResponse.json();
  if (!manifest || typeof manifest.entry !== "string" || !/^[a-zA-Z0-9_./-]+\.js$/.test(manifest.entry) || manifest.entry.includes("..")) {
    throw new Error("Invalid module entry in manifest");
  }
  const moduleResponse = await fetch(rawBase + manifest.entry, { cache: "no-store" });
  if (!moduleResponse.ok) throw new Error("Module request failed: HTTP " + moduleResponse.status);
  const source = await moduleResponse.text();
  // Import a Blob URL to avoid cross-origin JavaScript MIME-type issues with raw GitHub URLs.
  const moduleUrl = URL.createObjectURL(new Blob([source + "\n//# sourceURL=" + manifest.entry], { type: "text/javascript" }));
  try {
    const loaded = await import(moduleUrl);
    if (typeof loaded.respond !== "function") throw new Error("Module must export an async respond(prompt) function");
    return { ...loaded, name: loaded.name || manifest.name, version: loaded.version || manifest.version };
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}