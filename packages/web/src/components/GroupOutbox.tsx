import { useState } from 'react';
import type { Expense } from '../lib/expenses';
import type { GroupDetail } from '../lib/groups';
import {
  drop,
  isCreate,
  isEdit,
  OUTBOX_STORAGE_ERROR,
  type QueuedCreate,
  type QueuedEdit,
} from '../lib/outbox';
import type { OutboxSync } from '../lib/useOutboxSync';
import { AddExpenseForm } from './AddExpenseForm';
import { AddItemizedExpenseForm } from './AddItemizedExpenseForm';
import { OutboxNotice } from './OutboxNotice';
import { Sheet } from './Sheet';
import { useToast } from './Toast';

function restoreDraft(entry: QueuedCreate | QueuedEdit): Expense {
  const { payload } = entry;
  const queuedAt = new Date(entry.queuedAt).toISOString();
  return {
    id: isEdit(entry) ? entry.expenseId : entry.clientId,
    description: payload.description,
    amountCents: entry.amountCents,
    payerId: payload.payerId,
    category: payload.category ?? null,
    note: payload.note ?? null,
    createdAt: queuedAt,
    date: payload.date ?? queuedAt,
    version: payload.expectedVersion ?? 1,
    ...('items' in payload
      ? {
          splitMethod: 'ITEMIZED' as const,
          splits: [],
          items: payload.items,
          taxCents: payload.taxCents,
          tipCents: payload.tipCents,
        }
      : {
          splitMethod: payload.splitMethod,
          splits: payload.participants.map(({ userId, value }) => ({
            userId,
            inputValue: value ?? null,
            owedCents: 0,
          })),
        }),
  };
}

export function GroupOutbox({
  group,
  ownerId,
  count,
  sync,
  onSaved,
}: {
  group: GroupDetail;
  ownerId?: string | undefined;
  count: number;
  sync: OutboxSync;
  onSaved: (expense: Expense) => void;
}) {
  const toast = useToast();
  const [entry, setEntry] = useState<QueuedCreate | QueuedEdit | null>(null);
  const [saving, setSaving] = useState(false);
  const Form = entry && 'items' in entry.payload ? AddItemizedExpenseForm : AddExpenseForm;
  const draft = entry ? restoreDraft(entry) : null;

  return (
    <>
      <OutboxNotice
        count={count}
        waitingMessage={
          count === 1
            ? 'One change is waiting for a connection'
            : `${count} changes are waiting for a connection`
        }
        sync={sync}
        onCorrect={(change) => {
          if (isCreate(change) || isEdit(change)) setEntry(change);
        }}
      />
      <Sheet
        open={!!entry}
        onClose={() => setEntry(null)}
        title="Edit saved expense"
        protectChanges
        closeDisabled={saving}
      >
        {entry && draft && (
          <>
            <p className="mb-4 text-sm text-muted">
              Review who paid and who shared the cost, then save the corrected expense.
            </p>
            <Form
              key={entry.clientId}
              groupId={group.id}
              ownerId={ownerId}
              members={group.members}
              recoveryId={entry.clientId}
              {...(isEdit(entry) ? { editing: draft } : { template: draft })}
              onPendingChange={setSaving}
              onCreated={(saved) => {
                if (!drop(entry.clientId)) toast.error(OUTBOX_STORAGE_ERROR);
                setEntry(null);
                onSaved(saved);
              }}
              onQueued={() => {
                setEntry(null);
                toast.success('Corrected expense kept on this device. It will sync when you reconnect.');
              }}
            />
          </>
        )}
      </Sheet>
    </>
  );
}
