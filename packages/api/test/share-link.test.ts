import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { testDb, seedPerson } from './helpers.js';
import { createGroup, getOrCreateShareToken } from '../src/groups.js';

/**
 * The share link is the only way into this app without signing in, so it is the only URL anyone
 * would bother guessing at. These cover the two things that make a short token safe.
 */
describe('the public share link', () => {
  it('resolves a real token', async () => {
    const db = testDb();
    const alice = await seedPerson(db, 'Alice');
    const group = await createGroup(db, alice, 'Ski trip');
    const token = await getOrCreateShareToken(db, alice, group.id);

    const res = await SELF.fetch(`https://x/api/shared/${token}`);
    expect(res.status).toBe(200);
    expect((await res.json<{ summary: { groupName: string } }>()).summary.groupName).toBe('Ski trip');
  });

  it('turns away a malformed token', async () => {
    // Note: this passes with or without the shape pre-filter in index.ts, because an unknown
    // token 404s from the database anyway. The pre-filter exists to stop a guesser buying a D1
    // query and a rate-limit slot per attempt, which is a load property, not a visible one.
    for (const junk of ['x', 'not-a-token', 'K7QM4X2WNP9RT!', 'IIIIIIIIIIIIII']) {
      const res = await SELF.fetch(`https://x/api/shared/${encodeURIComponent(junk)}`);
      expect(res.status, junk).toBe(404);
    }
  });

  it('still resolves the long hex links already out in the world', async () => {
    // Old tokens are 64 hex characters. Those links are in people's messages and must not break.
    const db = testDb();
    const alice = await seedPerson(db, 'Alice');
    const group = await createGroup(db, alice, 'Old group');
    const legacy = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
    const { groups } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    await db.update(groups).set({ shareToken: legacy }).where(eq(groups.id, group.id));

    const res = await SELF.fetch(`https://x/api/shared/${legacy}`);
    expect(res.status).toBe(200);
  });

  it('is still reachable on the old /owewell prefix', async () => {
    // A browser holding a cached bundle or service worker is still calling this. Both prefixes
    // are the same routes, so this is the one case that proves the alias is mounted.
    const db = testDb();
    const alice = await seedPerson(db, 'Alice');
    const group = await createGroup(db, alice, 'Ski trip');
    const token = await getOrCreateShareToken(db, alice, group.id);

    const res = await SELF.fetch(`https://x/owewell/shared/${token}`);
    expect(res.status).toBe(200);
  });

  it('a well-formed but unknown token is a plain 404, not a hint', async () => {
    const res = await SELF.fetch('https://x/api/shared/K7QM4X2WNP9RTV');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('TOO_MANY');
  });
});
