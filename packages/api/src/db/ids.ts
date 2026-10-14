import { inArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/** Bound JSON keeps ID collections within D1's parameter budget without changing subqueries. */
export function inIds(column: SQLWrapper, values: readonly string[] | SQLWrapper): SQL {
  const source = Array.isArray(values)
    ? sql`(select value from json_each(${JSON.stringify(values)}))`
    : (values as SQLWrapper);
  return inArray(column, source);
}
