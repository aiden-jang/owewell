// Minimal service worker: enough for installability and an offline app shell.
// owewell's API and realtime WebSocket both live under /owewell/*, so that
// traffic always goes to the network and is never cached.

const CACHE = 'owewell-v1';
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

  // Never cache API / realtime traffic.
  if (url.pathname.startsWith('/owewell')) return;
  if (request.method !== 'GET') return;

  // Navigations: network first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(SHELL)));
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
