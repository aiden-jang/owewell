// Minimal service worker: enough for installability and an offline app shell.
// The API and the realtime WebSocket live under /api/* (and /owewell/*, the old prefix), so
// that traffic always goes to the network and is never cached.

// Bump this on any sw.js change: the activate handler deletes every cache that isn't the current
// one, so a version bump purges stale entries (including dev's unhashed modules) on update.
// v3 for the /api move. A browser still running the v2 worker does not know to skip /api, and
// its fallback branch caches unmatched GETs — so it could store a group's balances. Bumping the
// name means this worker's activate handler deletes that cache outright on the way in.
const CACHE = 'owewell-v3';
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API / realtime traffic. Both prefixes: old clients still call /owewell.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/owewell')) return;
  if (request.method !== 'GET') return;

  // Navigations: network first, and refresh the cached shell on the way through so an offline
  // return visit gets the most recent shell instead of the one frozen at first install.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, copy));
          return res;
        })
        .catch(() => caches.match(SHELL)),
    );
    return;
  }

  // Static assets: cache first, fill the cache on miss.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        }),
    ),
  );
});
