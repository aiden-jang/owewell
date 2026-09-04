import { SELF, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * An auth outage must not read as a sign-out. The web app answers 401 by clearing the user it
 * holds, so returning one for an unreachable auth service logs people out of their own groups
 * and hides ledgers that are perfectly fine.
 */
const AUTH = new URL(env.AUTH_URL).origin;

/* The Worker runs in this isolate, so stubbing fetch here is what it calls. Anything but the auth
   service is a mistake worth failing on rather than quietly letting out to the network. */
function authReplies(status: number, body: unknown): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== AUTH) throw new Error(`unexpected fetch to ${url.origin}`);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
}

afterEach(() => vi.unstubAllGlobals());

const signedIn = (path: string) => SELF.fetch(`https://x${path}`, { headers: { cookie: 'session=abc' } });

describe('the guard on /owewell', () => {
  it('answers 401 when there is no session', async () => {
    const res = await SELF.fetch('https://x/owewell/groups');
    expect(res.status).toBe(401);
  });

  it('answers 401 when auth rejects the session', async () => {
    authReplies(401, {});
    const res = await signedIn('/owewell/groups');
    expect(res.status).toBe(401);
  });

  it('answers 503, not 401, when auth cannot be reached', async () => {
    authReplies(500, 'down');
    const res = await signedIn('/owewell/groups');
    expect(res.status).toBe(503);
    expect((await res.json<{ error: string }>()).error).toBe('AUTH_UNAVAILABLE');
  });

  // /me makes the opposite call on purpose: owewell works signed-out, so the anonymous app is
  // the honest degraded state rather than an error.
  it('still reports a null user from /me during an outage', async () => {
    authReplies(500, 'down');
    const res = await signedIn('/api/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
  });
});
