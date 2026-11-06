import { getTableColumns, type InferInsertModel } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { DB } from './client.js';

const MAX_PARAMETERS = 100;

/** D1 bounds each statement’s parameters. Keep chunks in the caller’s transaction. */
export function insertStatements<T extends SQLiteTable>(db: DB, table: T, rows: InferInsertModel<T>[]) {
  if (!rows.length) return [];
  const chunkSize = Math.max(1, Math.floor(MAX_PARAMETERS / Object.keys(getTableColumns(table)).length));
  const statements = [];
  for (let start = 0; start < rows.length; start += chunkSize)
    statements.push(db.insert(table).values(rows.slice(start, start + chunkSize)));
  return statements;
}

export async function insertRows<T extends SQLiteTable>(
  db: DB,
  table: T,
  rows: InferInsertModel<T>[],
): Promise<void> {
  const [first, ...rest] = insertStatements(db, table, rows);
  if (first) await db.batch([first, ...rest]);
}
