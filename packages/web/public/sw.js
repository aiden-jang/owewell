// Cache only this app's static files. Group data and shared auth always use the network.
const CACHE = 'owewell-v4';
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.cache === 'no-store') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET') return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/owewell')) return;

  const navigation = request.mode === 'navigate';
  const key = navigation ? SHELL : request;
  const immutable = !navigation && url.pathname.startsWith('/assets/') && /-[\w-]{8,}\./.test(url.pathname);
  async function fromNetwork() {
    const response = await fetch(request, immutable ? undefined : { cache: 'no-cache' });
    if (response.ok && (!navigation || response.headers.get('content-type')?.includes('text/html'))) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(key, copy)));
    }
    return response;
  }

  // Hashed bundles are immutable. Icons, the manifest and HTML can change at the same URL.
  event.respondWith(immutable
    ? caches.match(key).then((hit) => hit || fromNetwork())
    : fromNetwork().catch(() => caches.match(key)));
});
