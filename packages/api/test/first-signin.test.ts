import { beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { getOrCreatePerson } from '../src/people.js';
import { people } from '../src/db/schema.js';
import { testDb } from './helpers.js';

/**
 * First sign-in.
 *
 * getOrCreatePerson runs in middleware on every /owewell/* request, and people.auth_user_id is UNIQUE.
 * It used to read, find nothing, and insert. A first sign-in means several requests land at once (the
 * SPA asks for the group list, the group, and opens the socket together), so all of them found nothing
 * and all of them inserted. One won and the rest hit the unique constraint, which nothing caught, so a
 * brand-new user's first page load returned {"error":"INTERNAL"} on some requests.
 *
 * That matters beyond the 500: those are the requests a user retries, and retried writes are how a
 * multi-step operation ends up half-applied.
 */

let db: ReturnType<typeof testDb>;

beforeEach(() => {
  db = testDb();
});

const authUser = (id: string, displayName: string) =>
  ({ id, displayName }) as Parameters<typeof getOrCreatePerson>[1];

describe('resolving an auth account to a person', () => {
  test('creates exactly one person, however many requests arrive together', async () => {
    const user = authUser('google-oauth2|david', 'David Seo');

    // Five concurrent first-time requests, which is what a fresh sign-in actually looks like.
    const results = await Promise.all(Array.from({ length: 5 }, () => getOrCreatePerson(db, user)));

    // None of them may fail, and they must all agree on who this person is.
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size, 'every concurrent request must resolve to the same person').toBe(1);

    const rows = await db.select({ id: people.id }).from(people).where(eq(people.authUserId, user.id)).all();
    expect(rows).toHaveLength(1);
  });

  test('is stable across later requests', async () => {
    const user = authUser('google-oauth2|harin', 'Harin Jung');
    const first = await getOrCreatePerson(db, user);
    for (let i = 0; i < 5; i++) {
      expect((await getOrCreatePerson(db, user)).id).toBe(first.id);
    }
  });

  test('keeps the display name fresh from auth', async () => {
    const first = await getOrCreatePerson(db, authUser('google-oauth2|eun', 'eunbin'));
    const renamed = await getOrCreatePerson(db, authUser('google-oauth2|eun', 'Eun Bin'));
    expect(renamed.id).toBe(first.id);
    expect(renamed.displayName).toBe('Eun Bin');
  });

  test('never returns a placeholder', async () => {
    // Placeholders have authUserId = null and must never be handed back as a signed-in identity.
    const person = await getOrCreatePerson(db, authUser('google-oauth2|new', 'New Person'));
    expect(person.isPlaceholder).toBe(false);
  });

  test('keeps two different accounts separate', async () => {
    const a = await getOrCreatePerson(db, authUser('google-oauth2|a', 'A'));
    const b = await getOrCreatePerson(db, authUser('google-oauth2|b', 'B'));
    expect(a.id).not.toBe(b.id);
  });
});
