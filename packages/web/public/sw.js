// Cache only this app's static files. Group data and shared auth always use the network.
const CACHE = 'owewell-v5';
const SHELL = '/';

async function cacheShell(cache, response) {
  const html = await response.clone().text();
  const assets = new Set(Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g), ([, url]) => url));
  const missing = await Promise.all([...assets].map(async (url) => (await cache.match(url, { ignoreVary: true })) ? null : url));
  await cache.addAll(missing.filter(Boolean));
  await cache.put(SHELL, response);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const shell = await fetch(SHELL, { cache: 'no-cache' });
    if (!shell.ok) throw new Error('Could not cache the Owewell shell.');
    await Promise.all([cacheShell(cache, shell), cache.add('/theme-init.js')]);
    await self.skipWaiting();
  })());
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
      event.waitUntil(caches.open(CACHE).then((cache) =>
        navigation ? cacheShell(cache, copy) : cache.put(key, copy)
      ).catch(() => undefined));
    }
    return response;
  }

  // Hashed bundles are immutable. Icons, the manifest and HTML can change at the same URL.
  event.respondWith(immutable
    ? caches.match(key, { ignoreVary: true }).then((hit) => hit || fromNetwork())
    : fromNetwork().catch(() => caches.match(key)));
});
