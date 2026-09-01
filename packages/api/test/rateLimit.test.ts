import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { perIp } from '../src/rateLimit.js';
import type { Env, RateLimiter } from '../src/env.js';

function limiter(allow: boolean, seen: string[] = []): RateLimiter {
  return {
    limit: async ({ key }) => {
      seen.push(key);
      return { success: allow };
    },
  };
}

function appWith(env: Partial<Env>) {
  const app = new Hono<{ Bindings: Env }>();
  app.use(
    '*',
    perIp((e) => e.API_LIMITER, 'Slow down a moment, then try again.'),
  );
  app.get('/x', (c) => c.json({ ok: true }));
  return (headers: Record<string, string> = { 'CF-Connecting-IP': '1.2.3.4' }) =>
    app.request('http://x/x', { headers }, env as Env);
}

describe('per-IP rate limiting', () => {
  it('lets a request through when under the limit', async () => {
    const res = await appWith({ API_LIMITER: limiter(true) })();
    expect(res.status).toBe(200);
  });

  it('refuses with a message the UI can actually show', async () => {
    const res = await appWith({ API_LIMITER: limiter(false) })();
    expect(res.status).toBe(429);
    // The web client falls back to "Request failed (429)" unless the body carries `message`.
    expect((await res.json<{ message: string }>()).message).toMatch(/slow down/i);
  });

  it('keys on the caller, not on everyone at once', async () => {
    const seen: string[] = [];
    const app = appWith({ API_LIMITER: limiter(true, seen) });
    await app({ 'CF-Connecting-IP': '1.1.1.1' });
    await app({ 'CF-Connecting-IP': '2.2.2.2' });
    expect(seen).toEqual(['1.1.1.1', '2.2.2.2']);
  });

  it('degrades open with no binding, so local dev is not bricked', async () => {
    const res = await appWith({})();
    expect(res.status).toBe(200);
  });

  it('degrades open with no client IP rather than refusing everyone', async () => {
    const res = await appWith({ API_LIMITER: limiter(false) })({});
    expect(res.status).toBe(200);
  });
});
