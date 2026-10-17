import type { CreateExpensePayload, CreateItemizedPayload } from '@owewell/core';
import type { Expense } from './expenses';
import { enqueue, isOffline, type QueuedCreate, type QueuedEdit } from './outbox';

type ExpensePayload = CreateExpensePayload | CreateItemizedPayload;

export type SaveOutcome =
  { status: 'saved'; expense: Expense } | { status: 'queued' } | { status: 'failed'; message: string };

interface Args<P extends ExpensePayload> {
  groupId: string;
  editing: Expense | undefined;
  /** Everything the server needs except the two fields this function owns. */
  base: Omit<P, 'clientId' | 'expectedVersion'>;
  /** For the outbox row's summary line, so a queued write reads sensibly in the pending list. */
  amountCents: number;
  kinds: { create: QueuedCreate['kind']; edit: QueuedEdit['kind'] };
  create: (groupId: string, payload: P) => Promise<Expense>;
  update: (groupId: string, expenseId: string, payload: P) => Promise<Expense>;
  /** False when the caller has nothing to tell the user about a queued write, so offline is an error. */
  canQueue: boolean;
  failureMessage: string;
}

/** Mint the create ID before requesting so retries keep the same identity.
 * Queue creates only; edits require conflict handling against the current row. */
export async function saveExpense<P extends ExpensePayload>({
  groupId,
  editing,
  base,
  amountCents,
  kinds,
  create,
  update,
  canQueue,
  failureMessage,
}: Args<P>): Promise<SaveOutcome> {
  const clientId = crypto.randomUUID();
  // An edit says which version it was based on; a create has none to be based on.
  const versioned = editing ? { expectedVersion: editing.version } : {};
  const payload = { ...base, clientId, ...versioned } as P;

  try {
    const expense = editing ? await update(groupId, editing.id, payload) : await create(groupId, payload);
    return { status: 'saved', expense };
  } catch (err) {
    if (!canQueue || !isOffline(err)) {
      return { status: 'failed', message: err instanceof Error ? err.message : failureMessage };
    }
    const row = {
      clientId,
      groupId,
      description: payload.description,
      amountCents,
      queuedAt: Date.now(),
      payload,
    };
    enqueue(editing ? { ...row, kind: kinds.edit, expenseId: editing.id } : { ...row, kind: kinds.create });
    return { status: 'queued' };
  }
}
