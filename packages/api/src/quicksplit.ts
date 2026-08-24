import { computeSplit, quickSplitSeed, type SplitMethod } from '@owewell/shared';
import type { DB } from './db/client.js';
import { createGroup } from './groups.js';
import { addPlaceholderMember } from './members.js';
import { createExpense } from './expenses.js';

export type QuickSplitErrorCode = 'NO_PAYER' | 'TOO_MANY_YOU' | 'NO_ITEMS' | 'INVALID_SPLIT' | 'INVALID_PAYER';

export class QuickSplitError extends Error {
  constructor(
    readonly code: QuickSplitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QuickSplitError';
  }
}

export interface QuickSplitPerson {
  name: string;
  isPayer?: boolean;
  isYou?: boolean;
}

export interface QuickSplitItem {
  description: string;
  amountCents: number;
  splitMethod: SplitMethod;
  /** Per-person values aligned to the `people` array order; null/omitted for EQUAL. */
  values?: (number | null)[];
  /** Index into `people` of who paid for this item. Omitted → the default payer. */
  payerIndex?: number;
}

export interface QuickSplitInput {
  people: QuickSplitPerson[];
  items: QuickSplitItem[];
}

/** Build the computeSplit participants for one item, aligning values to the shared people order. */
function itemParticipants(
  people: QuickSplitPerson[],
  item: QuickSplitItem,
  userId: (index: number) => string,
): { userId: string; value?: number }[] {
  return people.map((_, i) => {
    const v = item.values?.[i];
    return v === undefined || v === null ? { userId: userId(i) } : { userId: userId(i), value: v };
  });
}

/**
 * Turn a signed-out calculation into a saved group: the saving user owns it, every other person
 * becomes a name-only placeholder member, and each item becomes its own expense (all paid by the
 * one payer). Every item's split math is validated up front so a half-built group is never created.
 */
export async function createQuickSplit(
  db: DB,
  personId: string,
  input: QuickSplitInput,
): Promise<{ groupId: string }> {
  if (input.people.filter((p) => p.isPayer).length !== 1) {
    throw new QuickSplitError('NO_PAYER', 'Mark exactly one person as the payer.');
  }
  if (input.people.filter((p) => p.isYou).length > 1) {
    throw new QuickSplitError('TOO_MANY_YOU', 'Only one person can be you.');
  }
  if (input.items.length === 0) {
    throw new QuickSplitError('NO_ITEMS', 'Add at least one item.');
  }

  // Validate every item against placeholder ids before touching the database.
  for (const item of input.items) {
    if (item.payerIndex !== undefined && (item.payerIndex < 0 || item.payerIndex >= input.people.length)) {
      throw new QuickSplitError('INVALID_PAYER', 'An item payer is not one of the people on the split.');
    }
    try {
      computeSplit(item.splitMethod, item.amountCents, itemParticipants(input.people, item, (i) => `p${i}`));
    } catch (err) {
      throw new QuickSplitError('INVALID_SPLIT', err instanceof Error ? err.message : 'Invalid split.');
    }
  }

  const groupName = input.items[0]!.description.trim() || 'Quick split';
  const group = await createGroup(db, personId, groupName);

  // Resolve each person to a member id once, preserving order so item value arrays line up.
  const userIds: string[] = [];
  for (const p of input.people) {
    const uid = p.isYou
      ? personId
      : (await addPlaceholderMember(db, personId, group.id, p.name)).userId;
    userIds.push(uid);
  }
  const defaultPayerId = userIds[input.people.findIndex((p) => p.isPayer)]!;

  // The item's position is the seed, because it is the one value the browser can derive too. The
  // preview showed exact per-person cents before any of these rows existed; seeding from the
  // generated expense id would silently move a cent off whoever the user was just shown. Position
  // still rotates the odd cent across the items in a split, which is the point of seeding at all.
  for (const [index, item] of input.items.entries()) {
    await createExpense(db, personId, group.id, {
      description: item.description.trim() || 'Quick split',
      amountCents: item.amountCents,
      payerId: item.payerIndex !== undefined ? userIds[item.payerIndex]! : defaultPayerId,
      splitMethod: item.splitMethod,
      participants: itemParticipants(input.people, item, (i) => userIds[i]!),
      splitSeed: quickSplitSeed(index),
    });
  }

  return { groupId: group.id };
}
