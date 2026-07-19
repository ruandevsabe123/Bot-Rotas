const CACHE_NAME = "bot-rotas-shell-v4";
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

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Bot Rotas", body: event.data?.text() || "Existe um aviso importante no painel." };
  }
  event.waitUntil(self.registration.showNotification(data.title || "Bot Rotas", {
    body: data.body || "Existe um aviso importante no painel.",
    icon: data.icon || "/bot-icon-512.png",
    badge: data.badge || "/bot-icon-maskable-512.png",
    tag: data.tag || "bot-rotas-important",
    renotify: true,
    requireInteraction: Boolean(data.requireInteraction),
    data: { url: data.url || "/" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.navigate(targetUrl);
        return existing.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
