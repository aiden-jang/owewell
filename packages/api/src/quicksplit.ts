import { quickSplitSeed, type SplitMethod } from '@owewell/shared';
import type { DB } from './db/client.js';
import { and, eq, isNull } from 'drizzle-orm';
import { insertStatements } from './db/rows.js';
import { groups, groupMembers, people, expenses, expenseSplits } from './db/schema.js';
import { planExpenseCreate } from './expenseCreate.js';

export type QuickSplitErrorCode =
  'NO_PAYER' | 'TOO_MANY_YOU' | 'NO_ITEMS' | 'INVALID_SPLIT' | 'INVALID_PAYER';

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
  clientId?: string | undefined;
  draftId?: string | undefined;
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

  const { clientId, draftId } = input;
  const findByDraft = () =>
    draftId
      ? db
          .select({ groupId: groups.id })
          .from(groups)
          .where(and(eq(groups.createdById, personId), eq(groups.quickSplitDraftId, draftId)))
          .get()
      : undefined;
  const findSaved = async () => {
    const draft = await findByDraft();
    if (draft || !clientId) return draft;
    const saved = await db
      .select({ groupId: groups.id })
      .from(groups)
      .where(and(eq(groups.createdById, personId), eq(groups.quickSplitClientId, clientId)))
      .get();
    if (!saved || !draftId) return saved;
    try {
      await db
        .update(groups)
        .set({ quickSplitDraftId: draftId })
        .where(and(eq(groups.id, saved.groupId), isNull(groups.quickSplitDraftId)));
      return saved;
    } catch (error) {
      const linked = await findByDraft();
      if (linked) return linked;
      throw error;
    }
  };
  const saved = await findSaved();
  if (saved) return saved;

  const groupId = crypto.randomUUID();
  const placeholders = input.people.map((person) =>
    person.isYou ? null : { id: crypto.randomUUID(), displayName: person.name, isPlaceholder: true },
  );
  const userIds = placeholders.map((person) => person?.id ?? personId);
  const defaultPayerId = userIds[input.people.findIndex((person) => person.isPayer)]!;
  const writes = input.items.map((item, index) => {
    if (item.payerIndex !== undefined && (item.payerIndex < 0 || item.payerIndex >= userIds.length)) {
      throw new QuickSplitError('INVALID_PAYER', 'An item payer is not one of the people on the split.');
    }
    try {
      return planExpenseCreate(personId, groupId, {
        description: item.description.trim() || 'Quick split',
        amountCents: item.amountCents,
        payerId: item.payerIndex === undefined ? defaultPayerId : userIds[item.payerIndex]!,
        splitMethod: item.splitMethod,
        participants: itemParticipants(input.people, item, (i) => userIds[i]!),
        splitSeed: quickSplitSeed(index),
      });
    } catch (error) {
      throw new QuickSplitError('INVALID_SPLIT', error instanceof Error ? error.message : 'Invalid split.');
    }
  });

  try {
    await db.batch([
      db.insert(groups).values({
        id: groupId,
        name: input.items[0]!.description.trim() || 'Quick split',
        createdById: personId,
        quickSplitClientId: clientId ?? null,
        quickSplitDraftId: draftId ?? null,
      }),
      ...insertStatements(
        db,
        people,
        placeholders.filter((person) => person !== null),
      ),
      ...insertStatements(
        db,
        groupMembers,
        [personId, ...userIds.filter((id) => id !== personId)].map((id) => ({
          id: crypto.randomUUID(),
          groupId,
          personId: id,
          role: id === personId ? 'OWNER' : 'MEMBER',
        })),
      ),
      ...insertStatements(
        db,
        expenses,
        writes.map(({ row }) => row),
      ),
      ...insertStatements(
        db,
        expenseSplits,
        writes.flatMap(({ splitRows }) => splitRows),
      ),
    ]);
  } catch (error) {
    const winner = await findSaved();
    if (winner) return winner;
    throw error;
  }
  return { groupId };
}
