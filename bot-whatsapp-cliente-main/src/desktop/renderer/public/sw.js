const CACHE_NAME = "bot-rotas-shell-v2";
const SHELL_ASSETS = ["/manifest.webmanifest", "/bot-icon-512.png", "/bot-icon-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/") || url.pathname === "/events" || url.pathname === "/qr.svg") return;
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate" || url.pathname === "/") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }

  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
