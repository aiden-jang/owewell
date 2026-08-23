import { and, eq } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { requireMembership } from './groups.js';
import { ExpenseError } from './expenses.js';
import { expenses } from './db/schema.js';

/*
 * Receipt photos.
 *
 * Kept out of D1 (a 3MB image has no business in a row) and out of the create request. The expense
 * is written first and the photo is attached to it afterwards, so the object key is always
 * "<groupId>/<expenseId>": derivable, idempotent on re-upload, and impossible to orphan by
 * abandoning a form. The alternative — store on scan, remember a key, hope the form gets submitted —
 * leaves a bucket full of images nobody can reach.
 *
 * Storing pictures of receipts is not a neutral act: they routinely show the last four digits of a
 * card and sometimes a name. So they are private objects behind the same membership check as the
 * ledger, never public URLs, and they are deleted with the group.
 */

/** What a phone camera actually produces. HEIC included: iOS shoots it by default. */
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

/** Comfortably above a phone photo, far below anything that would hurt. */
export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

export type ReceiptErrorCode = 'UNSUPPORTED_TYPE' | 'TOO_LARGE';

export class ReceiptError extends Error {
  constructor(
    readonly code: ReceiptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReceiptError';
  }
}

const keyFor = (groupId: string, expenseId: string): string => `${groupId}/${expenseId}`;

async function liveExpense(db: DB, groupId: string, expenseId: string): Promise<{ receiptKey: string | null }> {
  const row = await db
    .select({ receiptKey: expenses.receiptKey })
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId)))
    .get();
  if (!row) throw new ExpenseError('NOT_FOUND', 'That expense no longer exists.');
  return row;
}

/** Attach (or replace) the photo on an expense. Any member may, like every other expense write. */
export async function putReceipt(
  db: DB,
  bucket: R2Bucket,
  personId: string,
  groupId: string,
  expenseId: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<void> {
  await requireMembership(db, personId, groupId);
  await liveExpense(db, groupId, expenseId);
  if (!ALLOWED.has(contentType)) {
    throw new ReceiptError('UNSUPPORTED_TYPE', 'That file is not an image owewell can store.');
  }
  if (body.byteLength > MAX_RECEIPT_BYTES) {
    throw new ReceiptError('TOO_LARGE', 'That photo is too big. 8MB is the limit.');
  }

  const key = keyFor(groupId, expenseId);
  await bucket.put(key, body, { httpMetadata: { contentType } });
  // Written after the object lands, so a failed upload never leaves a row pointing at nothing.
  await db.update(expenses).set({ receiptKey: key }).where(eq(expenses.id, expenseId));
}

/** The stored photo, or null. Members only: the ledger's access rules cover its attachments. */
export async function getReceipt(
  db: DB,
  bucket: R2Bucket,
  personId: string,
  groupId: string,
  expenseId: string,
): Promise<R2ObjectBody | null> {
  await requireMembership(db, personId, groupId);
  const { receiptKey } = await liveExpense(db, groupId, expenseId);
  if (!receiptKey) return null;
  return bucket.get(receiptKey);
}

export async function deleteReceipt(
  db: DB,
  bucket: R2Bucket,
  personId: string,
  groupId: string,
  expenseId: string,
): Promise<void> {
  await requireMembership(db, personId, groupId);
  const { receiptKey } = await liveExpense(db, groupId, expenseId);
  if (!receiptKey) return;
  await bucket.delete(receiptKey);
  await db.update(expenses).set({ receiptKey: null }).where(eq(expenses.id, expenseId));
}

/** R2 caps a bulk delete at 1000 keys, so this goes in batches for a group with a long history. */
export async function deleteReceipts(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await bucket.delete(keys.slice(i, i + 1000));
  }
}
