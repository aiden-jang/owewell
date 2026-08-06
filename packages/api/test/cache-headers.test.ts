import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * A response whose body depends on who is asking must never be stored.
 *
 * /owewell/me shipped with no Cache-Control at all, and a GET with no directives is heuristically
 * cacheable, so the browser invents its own freshness lifetime and keeps it. The same omission in
 * accounts produced a real, reported bug: sign out, press back, the page re-checks the session, the
 * browser answers from its own cache, and you appear signed in until a refresh.
 *
 * This is the first HTTP-level test in this package. Every other test here calls the handlers or the
 * database directly, which is faster and better for logic, and is also precisely why a missing response
 * header could sit in production unnoticed: nothing was looking at the response.
 */
describe('cache headers', () => {
  const paths = ['/owewell/me', '/owewell/groups'];

  it.each(paths)('%s is never cacheable', async (path) => {
    const res = await SELF.fetch(`https://x${path}`);
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc, `${path} returned ${res.status} with cache-control: ${cc || '(none)'}`).toContain(
      'no-store',
    );
  });

  it('sets it on an unauthenticated response too', async () => {
    // Both directions matter: a cached `{user: null}` keeps telling a freshly signed-in person that
    // they are signed out, which is the same bug wearing a different hat.
    const res = await SELF.fetch('https://x/owewell/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});
