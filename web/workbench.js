(() => {
  const $ = id => document.getElementById(id);
  const show = id => { const el = $(id); if (!el) return; el.classList.remove("hidden", "is-closing"); };
  const hide = id => {
    const el = $(id);
    if (!el || el.classList.contains("hidden")) return;
    if (el.classList.contains("settingsgate") || el.classList.contains("osintgate")) {
      el.classList.add("is-closing");
      let finished = false;
      const finish = () => { if (finished) return; finished = true; el.classList.add("hidden"); el.classList.remove("is-closing"); el.removeEventListener("animationend", finish); };
      el.addEventListener("animationend", finish);
      window.setTimeout(finish, 280);
    } else el.classList.add("hidden");
  };
  $("openWorkbench")?.addEventListener("click", () => show("workbenchGate"));
  $("closeWorkbench")?.addEventListener("click", () => hide("workbenchGate"));
  $("clearSandbox")?.addEventListener("click", () => {
    $("sandboxCode").value = "";
    $("sandboxPreview").srcdoc = "";
    $("sandboxStatus").textContent = "Sandbox cleared.";
  });
  $("runSandbox")?.addEventListener("click", async () => {
    try {
      const settingsResponse = await fetch("/api/settings", { credentials: "same-origin" });
      const settingsData = await settingsResponse.json();
      if (!settingsResponse.ok) throw new Error(settingsData.error || "Could not read settings.");
      if (settingsData.settings?.sandboxMode === false) { $("sandboxStatus").textContent = "Enable Code Workbench in Settings first."; return; }
    } catch (error) { $("sandboxStatus").textContent = error.message; return; }
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
  let researchType = "web";
  const openResearchMode = type => {
    researchType = type;
    const isNews = type === "news";
    $("researchTitle").textContent = isNews ? "News Search" : "Live Web Research";
    $("researchDescription").textContent = isNews ? "Search recent news stories using Brave Search. Check the publisher and publication time before relying on a report." : "Searches the web through a configured Brave Search API key. Results include source links; verify important claims against the original pages.";
    $("researchQuery").placeholder = isNews ? "Search recent news…" : "Search for current information…";
    $("researchSubmit").textContent = isNews ? "Search news" : "Search web";
    $("researchStatus").textContent = "";
    $("researchResults").replaceChildren();
    show("researchGate");
    $("researchQuery").focus();
  };
  $("openResearch")?.addEventListener("click", () => openResearchMode("web"));
  $("openNews")?.addEventListener("click", () => openResearchMode("news"));
  $("closeResearch")?.addEventListener("click", () => hide("researchGate"));
  $("researchForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const query = $("researchQuery").value.trim();
    if (!query) return;
    $("researchStatus").textContent = researchType === "news" ? "Searching recent news sources…" : "Searching current web sources…";
    $("researchResults").replaceChildren();
    try {
      const response = await fetch("/api/research/search", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, type: researchType })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search request failed.");
      $("researchStatus").textContent = "Found " + data.results.length + (researchType === "news" ? " news stories. Check publication times and original reporting." : " results. Verify important claims against original pages.");
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
