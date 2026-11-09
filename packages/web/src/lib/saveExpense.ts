import type { CreateExpensePayload, CreateItemizedPayload } from '@owewell/core';
import type { Expense } from './expenses';
import type { ExpenseAttempt } from './expenseEditorDraft';
import {
  drop,
  enqueue,
  isCurrentOutboxEntry,
  isOffline,
  OUTBOX_STORAGE_ERROR,
  withOutboxLock,
  type QueuedCreate,
  type QueuedEdit,
} from './outbox';

type ExpensePayload = CreateExpensePayload | CreateItemizedPayload;

export const CORRECTION_CONFLICT =
  'Correction conflict. Another tab picked up this change. Your draft is still here. Check the group’s expense before making further changes.';

export type SaveOutcome =
  { status: 'saved'; expense: Expense } | { status: 'queued' } | { status: 'failed'; message: string };

interface Args<P extends ExpensePayload> {
  groupId: string;
  ownerId?: string | undefined;
  attempt: { current: ExpenseAttempt | null };
  onAttempt?: () => void;
  editing: Expense | undefined;
  correction?: QueuedCreate | QueuedEdit | undefined;
  /** Everything the server needs except the two fields this function owns. */
  base: Omit<P, 'clientId' | 'expectedVersion'>;
  /** For the outbox row's summary line, so a queued write reads sensibly in the pending list. */
  amountCents: number;
  kinds: { create: QueuedCreate['kind']; edit: QueuedEdit['kind'] };
  create: (groupId: string, payload: P, ownerId?: string) => Promise<Expense>;
  update: (groupId: string, expenseId: string, payload: P, ownerId?: string) => Promise<Expense>;
  /** False when the caller has nothing to tell the user about a queued write, so offline is an error. */
  canQueue: boolean;
  failureMessage: string;
}

/** Mint the ID before requesting so retries keep the same identity. */
export async function saveExpense<P extends ExpensePayload>({
  groupId,
  ownerId,
  attempt,
  onAttempt,
  editing,
  correction,
  base,
  amountCents,
  kinds,
  create,
  update,
  canQueue,
  failureMessage,
}: Args<P>): Promise<SaveOutcome> {
  const key = JSON.stringify([groupId, ownerId, editing?.id, editing?.version, base]);
  const clientId =
    correction?.clientId ?? (attempt.current?.key === key ? attempt.current.id : crypto.randomUUID());
  attempt.current = { key, id: clientId };
  onAttempt?.();
  // An edit says which version it was based on; a create has none to be based on.
  const versioned = editing ? { expectedVersion: editing.version } : {};
  const payload = { ...base, clientId, ...versioned } as P;

  async function save(): Promise<SaveOutcome> {
    if (correction && !isCurrentOutboxEntry(correction)) {
      return { status: 'failed', message: CORRECTION_CONFLICT };
    }
    const fields = {
      clientId,
      groupId,
      ownerId,
      description: payload.description,
      amountCents,
      queuedAt: Math.max(Date.now(), (correction?.queuedAt ?? 0) + 1),
      payload,
    };
    const row = editing
      ? { ...fields, kind: kinds.edit, expenseId: editing.id }
      : { ...fields, kind: kinds.create };
    // Persist the winning correction before sending, so a reload mid-request can replay it.
    if (correction && !enqueue(row)) return { status: 'failed', message: OUTBOX_STORAGE_ERROR };
    try {
      const expense = editing
        ? await update(groupId, editing.id, payload, ownerId)
        : await create(groupId, payload, ownerId);
      if (correction && !isCurrentOutboxEntry(row)) return { status: 'failed', message: CORRECTION_CONFLICT };
      if (correction && !drop(clientId)) return { status: 'failed', message: OUTBOX_STORAGE_ERROR };
      attempt.current = null;
      return { status: 'saved', expense };
    } catch (err) {
      if (canQueue && isOffline(err)) {
        if (!correction && !enqueue(row)) return { status: 'failed', message: OUTBOX_STORAGE_ERROR };
        attempt.current = null;
        return { status: 'queued' };
      }
      if (correction && !isCurrentOutboxEntry(row)) return { status: 'failed', message: CORRECTION_CONFLICT };
      if (correction && !enqueue(correction)) return { status: 'failed', message: OUTBOX_STORAGE_ERROR };
      return { status: 'failed', message: err instanceof Error ? err.message : failureMessage };
    }
  }

  return correction ? withOutboxLock(ownerId, save) : save();
}
