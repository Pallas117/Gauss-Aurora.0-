const CACHE_NAME = "gauss-offline-shell-v1";
const APP_SHELL_URLS = ["/", "/index.html", "/favicon.ico", "/robots.txt"];
const NETWORK_TIMEOUT_MS = 2500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function shouldHandleRequest(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  // Cache only safe, read-only feed endpoints. Avoid caching auth/security/ops/admin.
  if (url.pathname.startsWith("/api/")) {
    return url.pathname.startsWith("/api/feed/");
  }
  if (request.mode === "navigate") return true;
  if (/\.(js|css|png|svg|ico|woff2?)$/i.test(url.pathname)) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!shouldHandleRequest(request)) {
    return;
  }

  event.respondWith(
    fetchWithTimeout(request, NETWORK_TIMEOUT_MS)
      .then(async (response) => {
        if (!response || !response.ok) {
          const cached = await caches.match(request);
          if (cached) {
            return cached;
          }
          return response;
        }
        const clone = response.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(request, clone))
          .catch(() => undefined);
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        if (request.mode === "navigate") {
          const fallback = await caches.match("/index.html");
          if (fallback) {
            return fallback;
          }
        }
        return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }),
  );
});

function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}
