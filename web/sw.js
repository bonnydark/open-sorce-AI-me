const CACHE_NAME = "gortgpt-shell-v6";
const SHELL = ["/", "/chat.html", "/manifest.json", "/icon.svg?v=5"];

// Precache best-effort: one missing/redirected asset must not reject the
// entire Service Worker installation (Cache.addAll rejects on any failure).
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        await Promise.all(SHELL.map(async path => {
          try {
            const request = new Request(new URL(path, self.location.origin), {
              cache: "reload",
              credentials: "same-origin"
            });
            const response = await fetch(request);
            if (response.ok && response.type !== "opaque") {
              await cache.put(request, response);
            } else {
              console.warn("[GortGPT SW] Skipping precache asset:", path, response.status);
            }
          } catch (error) {
            // Offline/redirected/missing optional shell assets should not
            // prevent the app and read-only share pages from loading.
            console.warn("[GortGPT SW] Could not precache:", path, error);
          }
        }));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key =>
          (key.startsWith("open-source-ai-me-shell-") || key.startsWith("gortgpt-shell-")) &&
          key !== CACHE_NAME
        ).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(response => {
        // Cache only the canonical landing page. Never cache share URLs or
        // user/chat routes as the app shell, and never cache API responses.
        if (response.ok && (url.pathname === "/" || url.pathname === "/index.html")) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put("/", copy)).catch(() => {});
        }
        return response;
      }).catch(async () => (await caches.match(request)) || (await caches.match("/")) || Response.error())
    );
    return;
  }

  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone())).catch(() => {});
        }
        return response;
      }).catch(() => caches.match(request))
    );
  }
});
