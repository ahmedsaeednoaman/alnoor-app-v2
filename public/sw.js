/* Alnoor PWA foundation: cache public static assets only. */
const STATIC_CACHE = "alnoor-static-v1";
const OWNED_CACHE_PREFIX = "alnoor-static-";
const PRECACHE_URLS = [
  "/icons/pwa-192.png",
  "/icons/pwa-512.png",
  "/icons/pwa-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/images/Al-Noor Endoscope Medical Logo.png",
  "/images/alnoor-endoscopy-scene.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith(OWNED_CACHE_PREFIX) && name !== STATIC_CACHE,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isSafeStaticRequest(request, url) {
  return (
    PRECACHE_URLS.includes(url.pathname) ||
    (url.pathname.startsWith("/_next/static/") &&
      ["font", "image", "script", "style"].includes(request.destination))
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // The server remains authoritative for navigations, APIs, RSC, Server
  // Actions, authenticated data, and every mutation.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    request.mode === "navigate" ||
    url.pathname.startsWith("/api/") ||
    request.headers.has("Next-Action") ||
    request.headers.has("RSC") ||
    !isSafeStaticRequest(request, url)
  ) {
    return;
  }

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
      }
      return response;
    }),
  );
});

// Push adds no authenticated/offline caching. Only fixed, privacy-safe copy is shown.
function safePushPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\s\u0000-\u001f]/.test(value)) return "/operations";
  try {
    const url = new URL(value, self.location.origin);
    // Phase 2A self-test requires only this existing authenticated route.
    if (url.origin !== self.location.origin || url.pathname !== "/operations" || url.search || url.hash) return "/operations";
    return "/operations";
  } catch { return "/operations"; }
}
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Fixed fallback below. */ }
  event.waitUntil(self.registration.showNotification("النور للمناظير الطبية", {
    body: "تم تفعيل إشعارات النور بنجاح.",
    icon: "/icons/pwa-192.png",
    tag: "alnoor-push-test",
    data: { type: "push-test", url: safePushPath(payload?.url) },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePushPath(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try {
        const navigated = await client.navigate(path);
        if (navigated) { await navigated.focus(); return; }
      } catch { /* Open a fresh authenticated app window if navigation failed. */ }
    }
    await self.clients.openWindow(path);
  })());
});
