import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { groups } from './db/schema.js';

export function groupWriteGuard(db: DB, id: string, version: number, condition?: SQL) {
  // The NOT NULL constraint aborts the whole batch if the ledger changed before it could commit.
  return db
    .update(groups)
    .set({
      ledgerVersion: sql`CASE WHEN ${and(eq(groups.ledgerVersion, version), condition)} THEN ${groups.ledgerVersion} END`,
    })
    .where(eq(groups.id, id))
    .returning({ id: groups.id });
}
