import { getTableColumns, type InferInsertModel } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { DB } from './client.js';

const MAX_PARAMETERS = 100;

/** D1 bounds each statement's parameters; batch the bounded inserts as one transaction. */
export async function insertRows<T extends SQLiteTable>(
  db: DB,
  table: T,
  rows: InferInsertModel<T>[],
): Promise<void> {
  if (!rows.length) return;
  const chunkSize = Math.max(1, Math.floor(MAX_PARAMETERS / Object.keys(getTableColumns(table)).length));
  const first = db.insert(table).values(rows.slice(0, chunkSize));
  const rest = [];
  for (let start = chunkSize; start < rows.length; start += chunkSize)
    rest.push(db.insert(table).values(rows.slice(start, start + chunkSize)));
  await db.batch([first, ...rest]);
}
