(() => {
  const $ = id => document.getElementById(id);
  const show = id => $(id)?.classList.remove("hidden");
  const hide = id => $(id)?.classList.add("hidden");
  $("openWorkbench")?.addEventListener("click", () => show("workbenchGate"));
  $("closeWorkbench")?.addEventListener("click", () => hide("workbenchGate"));
  $("clearSandbox")?.addEventListener("click", () => {
    $("sandboxCode").value = "";
    $("sandboxPreview").srcdoc = "";
    $("sandboxStatus").textContent = "Sandbox cleared.";
  });
  $("runSandbox")?.addEventListener("click", () => {
    const code = $("sandboxCode").value;
    const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; connect-src \'none\'; font-src data:">';
    $("sandboxPreview").srcdoc = '<!doctype html><html><head><meta charset="utf-8">' + policy + '</head><body>' + code + '</body></html>';
    $("sandboxStatus").textContent = "Running in a sandboxed iframe. Network access is blocked. Avoid pasting secrets into code.";
  });
  $("downloadSandbox")?.addEventListener("click", () => {
    const blob = new Blob([$("sandboxCode").value], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sandbox-project.html";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("openResearch")?.addEventListener("click", () => show("researchGate"));
  $("closeResearch")?.addEventListener("click", () => hide("researchGate"));
  $("researchForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const query = $("researchQuery").value.trim();
    if (!query) return;
    $("researchStatus").textContent = "Searching current web sources…";
    $("researchResults").replaceChildren();
    try {
      const response = await fetch("/api/research/search", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search request failed.");
      $("researchStatus").textContent = "Found " + data.results.length + " results. Verify important claims against original pages.";
      for (const item of data.results) {
        const link = document.createElement("a");
        link.className = "osintlink";
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const title = document.createElement("strong");
        title.textContent = item.title || item.url;
        const description = document.createElement("small");
        description.textContent = (item.description || "") + (item.age ? " · " + item.age : "");
        link.append(title, description);
        $("researchResults").append(link);
      }
    } catch (error) {
      $("researchStatus").textContent = error.message;
    }
  });
})();
