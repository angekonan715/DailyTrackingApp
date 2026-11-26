// Minimal service worker: makes Daily Hub installable and caches the app shell.
const CACHE = "daily-hub-v4";
const SHELL = ["/today", "/workouts", "/workouts/track", "/hobbies", "/books", "/summary"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

// Network first for pages, fall back to cache when offline.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((r) => r || caches.match("/today")),
    ),
  );
});
