self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Intentionally no fetch/cache handler.
// AKEDA contains live lessons, tests, balances and progress, so authenticated
// pages must always use the network instead of a stale offline cache.
