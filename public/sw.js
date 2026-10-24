const CACHE = "sako-shell-v5";
const SHELL = [
  "/",
  "/app.js",
  "/privacy.html",
  "/help.html",
  "/returns.html",
  "/support.js",
  "/agreement.html",
  "/theme-init.js",
  "/style.css",
  "/css/base.css",
  "/css/components.css",
  "/css/storefront.css",
  "/css/themes.css",
  "/css/features.css",
  "/leaflet.js",
  "/leaflet.css",
  "/assets/app-icon.svg",
  "/assets/app-icon-192.png",
  "/assets/app-icon-512.png",
  "/manifest.webmanifest",
  "/assets/rice-fields.svg",
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("sako-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never cache API responses, private data, media uploads, or mutations. Offline checkout is deliberately unsupported.
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !SHELL.includes(url.pathname)
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put(event.request, copy)),
          );
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
