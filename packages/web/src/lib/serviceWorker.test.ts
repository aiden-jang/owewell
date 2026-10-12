import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const put = vi.fn().mockResolvedValue(undefined);
  const match = vi.fn().mockResolvedValue(new Response('old'));
  const fetch = vi.fn().mockResolvedValue(new Response('new'));
  runInNewContext(source, {
    URL,
    fetch,
    caches: { match, open: vi.fn().mockResolvedValue({ put }), keys: vi.fn().mockResolvedValue([]) },
    self: {
      location: { origin: 'https://owewell.example' },
      addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn() },
    },
  });
  async function request(path: string) {
    let result: Promise<Response | undefined> | undefined;
    const writes: Promise<unknown>[] = [];
    handlers.get('fetch')!({
      request: new Request(new URL(path, 'https://owewell.example')),
      respondWith: (response: Promise<Response | undefined>) => {
        result = response;
      },
      waitUntil: (write: Promise<unknown>) => writes.push(write),
    });
    const response = await result;
    await Promise.all(writes);
    return response;
  }
  return { request, fetch, match, put };
}

describe('installed app cache', () => {
  it('refreshes files whose URL stays the same', async () => {
    const app = worker();
    expect(await (await app.request('/manifest.webmanifest'))?.text()).toBe('new');
    expect(app.match).not.toHaveBeenCalled();
    expect(app.put).toHaveBeenCalled();
  });
  it('uses hashed assets offline without a network request', async () => {
    const app = worker();
    expect(await (await app.request('/assets/index-abcdefgh.js'))?.text()).toBe('old');
    expect(app.fetch).not.toHaveBeenCalled();
  });
  it('falls back to the cached icon when disconnected', async () => {
    const app = worker();
    app.fetch.mockRejectedValue(new TypeError('offline'));
    expect(await (await app.request('/icon.svg'))?.text()).toBe('old');
  });
  it('does not overwrite a good cache with a failed response', async () => {
    const app = worker();
    app.fetch.mockResolvedValue(new Response('unavailable', { status: 503 }));
    expect((await app.request('/icon.svg'))?.status).toBe(503);
    expect(app.put).not.toHaveBeenCalled();
  });
  it.each(['/api/groups', '/owewell/groups', 'https://accounts.example/login'])(
    'leaves %s outside the cache',
    async (path) => {
      const app = worker();
      expect(await app.request(path)).toBeUndefined();
      expect(app.fetch).not.toHaveBeenCalled();
      expect(app.match).not.toHaveBeenCalled();
    },
  );
});
