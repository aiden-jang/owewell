import { env } from 'cloudflare:test';
import { createDb, type DB } from '../src/db/client.js';
import { people } from '../src/db/schema.js';

/** A drizzle handle over the test worker's real (in-memory) D1. */
export function testDb(): DB {
  return createDb(env);
}

/** Insert a real (non-placeholder) person and return its id. Stands in for a signed-in user. */
export async function seedPerson(db: DB, displayName: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(people).values({ id, displayName, isPlaceholder: false });
  return id;
}
