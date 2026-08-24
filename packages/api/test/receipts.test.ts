import { beforeEach, describe, expect, test } from 'vitest';
import { createGroup, deleteGroup } from '../src/groups.js';
import { addPlaceholderMember } from '../src/members.js';
import { createExpense, listExpenses } from '../src/expenses.js';
import { deleteReceipt, deleteReceipts, getReceipt, putReceipt } from '../src/receipts.js';
import { testDb, seedPerson } from './helpers.js';

/**
 * Receipt photos.
 *
 * The rules worth holding are about access and cleanup rather than pixels: an image of a receipt can
 * show the last four digits of somebody's card, and an image nobody can reach is still an image
 * being paid for every month.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;

/*
 * An in-memory stand-in for the bucket.
 *
 * Every function here takes the bucket as an argument rather than reaching for `env`, which makes
 * this possible: the logic under test is access control, key derivation and cleanup, none of which
 * needs real object storage. It also dodges a live bug in vitest-pool-workers, whose isolated
 * storage cannot roll back R2 between tests (it trips over the SQLite -shm sidecar and fails the
 * whole file). Real R2 semantics are Cloudflare's code, not ours.
 */
function fakeBucket() {
  const objects = new Map<string, { body: ArrayBuffer; contentType: string }>();
  return {
    objects,
    put: (key: string, body: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => {
      objects.set(key, { body, contentType: opts?.httpMetadata?.contentType ?? '' });
      return Promise.resolve({} as R2Object);
    },
    get: (key: string) => {
      const hit = objects.get(key);
      return Promise.resolve(
        hit ? ({ httpMetadata: { contentType: hit.contentType }, body: hit.body } as unknown as R2ObjectBody) : null,
      );
    },
    delete: (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
      return Promise.resolve();
    },
    list: ({ prefix }: { prefix: string }) =>
      Promise.resolve({
        objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
      }),
  } as unknown as R2Bucket & { objects: Map<string, { body: ArrayBuffer; contentType: string }> };
}

let db: ReturnType<typeof testDb>;
let alice: string;
let groupId: string;
let expenseId: string;
let bucket: ReturnType<typeof fakeBucket>;

beforeEach(async () => {
  db = testDb();
  bucket = fakeBucket();
  alice = await seedPerson(db, 'Alice');
  const group = await createGroup(db, alice, 'Flat');
  groupId = group.id;
  const bob = (await addPlaceholderMember(db, alice, groupId, 'Bob')).userId;
  expenseId = (
    await createExpense(db, alice, groupId, {
      description: 'Dinner',
      amountCents: 4_000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    })
  ).id;
});

describe('attaching one', () => {
  test('stores it and marks the expense as having one', async () => {
    expect((await listExpenses(db, alice, groupId))[0]!.hasReceipt).toBe(false);
    await putReceipt(db, bucket, alice, groupId, expenseId, PNG, 'image/png');

    expect((await listExpenses(db, alice, groupId))[0]!.hasReceipt).toBe(true);
    const stored = await getReceipt(db, bucket, alice, groupId, expenseId);
    expect(stored).not.toBeNull();
    expect(stored!.httpMetadata?.contentType).toBe('image/png');
  });

  /*
   * The key is derived from the ids rather than random, so a second upload replaces the first.
   * A random key per upload would leave the old object behind with nothing referencing it.
   */
  test('replaces rather than accumulates when a photo is re-taken', async () => {
    await putReceipt(db, bucket, alice, groupId, expenseId, PNG, 'image/png');
    await putReceipt(db, bucket, alice, groupId, expenseId, PNG, 'image/jpeg');
    const listed = await bucket.list({ prefix: `${groupId}/` });
    expect(listed.objects).toHaveLength(1);
    expect((await getReceipt(db, bucket, alice, groupId, expenseId))!.httpMetadata?.contentType).toBe(
      'image/jpeg',
    );
  });

  test('refuses anything that is not an image a phone takes', async () => {
    await expect(
      putReceipt(db, bucket, alice, groupId, expenseId, PNG, 'application/pdf'),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });

  test('refuses one that is too big to be a photo of a receipt', async () => {
    const huge = new ArrayBuffer(9 * 1024 * 1024);
    await expect(
      putReceipt(db, bucket, alice, groupId, expenseId, huge, 'image/jpeg'),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });
});

describe('who can see it', () => {
  test('a stranger cannot read or write one', async () => {
    await putReceipt(db, bucket, alice, groupId, expenseId, PNG, 'image/png');
    const stranger = await seedPerson(db, 'Nosy');
    // NOT_FOUND rather than a permission error, the same convention the rest of the ledger uses:
    // telling somebody "you are not allowed" confirms the group exists.
    await expect(getReceipt(db, bucket, stranger, groupId, expenseId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      putReceipt(db, bucket, stranger, groupId, expenseId, PNG, 'image/png'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('an expense with no photo reads as no photo, not as an error', async () => {
    expect(await getReceipt(db, bucket, alice, groupId, expenseId)).toBeNull();
  });
});

describe('cleanup', () => {
  test('removing the photo leaves the expense alone', async () => {
    await putReceipt(db, bucket, alice, groupId, expenseId, PNG, 'image/png');
    await deleteReceipt(db, bucket, alice, groupId, expenseId);

    expect(await bucket.get(`${groupId}/${expenseId}`)).toBeNull();
    const [expense] = await listExpenses(db, alice, groupId);
    expect(expense!.hasReceipt).toBe(false);
    expect(expense!.amountCents).toBe(4_000);
  });

  /*
   * Deleting a group is the one operation that really destroys data, so it has to take the images
   * with it. Nothing can find them afterwards: the rows that named them are gone.
   */
  test('deleting the group takes its photos with it', async () => {
    await putReceipt(db, bucket, alice, groupId, expenseId, PNG, 'image/png');
    const keys = await deleteGroup(db, alice, groupId);
    expect(keys).toEqual([`${groupId}/${expenseId}`]);

    await deleteReceipts(bucket, keys);
    expect((await bucket.list({ prefix: `${groupId}/` })).objects).toHaveLength(0);
  });
});
