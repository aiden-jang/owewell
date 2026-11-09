import { useState } from 'react';
import type { Expense } from '../lib/expenses';
import type { GroupDetail } from '../lib/groups';
import {
  correctionDraftKey,
  discardExpenseEditorDraft,
  readCorrectionDrafts,
  readExpenseEditorDraft,
  type ExpenseDraftInput,
} from '../lib/expenseEditorDraft';
import { isCreate, isCurrentOutboxEntry, isEdit, type QueuedCreate, type QueuedEdit } from '../lib/outbox';
import { CORRECTION_CONFLICT } from '../lib/saveExpense';
import type { OutboxSync } from '../lib/useOutboxSync';
import { AddExpenseForm } from './AddExpenseForm';
import { AddItemizedExpenseForm } from './AddItemizedExpenseForm';
import { useConfirm } from './Confirm';
import { FormError } from './FormFields';
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
  const confirm = useConfirm();
  const [drafts, setDrafts] = useState(() => readCorrectionDrafts(ownerId, group.id));
  const [correction, setCorrection] = useState<{
    entry?: QueuedCreate | QueuedEdit;
    mode: ExpenseDraftInput['mode'];
    draftKey: string | undefined;
    restored: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const { entry, draftKey, restored = false } = correction ?? {};
  const Form = correction?.mode === 'itemized' ? AddItemizedExpenseForm : AddExpenseForm;
  const conflict = !!correction && !saving && (!entry || !isCurrentOutboxEntry(entry));
  const draft = entry ? restoreDraft(entry) : undefined;
  const activeDraftKeys = new Set(sync.failed.map(correctionDraftKey));
  const conflictedDrafts = drafts.filter(({ key }) => !activeDraftKeys.has(key));

  function closeCorrection() {
    if (!conflict) discardExpenseEditorDraft(draftKey);
    setCorrection(null);
    setDrafts(readCorrectionDrafts(ownerId, group.id));
  }

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
        groupName={() => group.name}
        onCorrect={(change) => {
          if (!isCreate(change) && !isEdit(change)) return;
          const key = correctionDraftKey(change);
          setCorrection({
            entry: change,
            mode: 'items' in change.payload ? 'itemized' : 'simple',
            draftKey: key,
            restored: !!readExpenseEditorDraft(key),
          });
        }}
      />
      {conflictedDrafts.length > 0 && (
        <ul
          aria-label="Correction drafts"
          className="divide-y divide-line rounded-2xl border border-dashed border-line-strong px-3 text-sm"
        >
          {conflictedDrafts.map(({ key, mode, description }) => (
            <li key={key} className="py-2 [overflow-wrap:anywhere]">
              <p className="font-medium text-ink">{description || 'Unnamed expense'}</p>
              <p className="text-muted">Correction conflict. Your draft is saved in this tab.</p>
              <div className="mt-1 flex flex-wrap gap-x-4">
                <button
                  type="button"
                  data-focus-return={key}
                  onClick={() => setCorrection({ mode, draftKey: key, restored: true })}
                  className="tap inline-flex min-h-11 items-center font-medium text-accent underline"
                >
                  Review correction draft
                </button>
                <button
                  type="button"
                  className="tap inline-flex min-h-11 items-center text-muted underline"
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: 'Discard this correction draft?',
                        body: 'This removes the draft from this tab.',
                        confirmLabel: 'Discard draft',
                        tone: 'danger',
                      }))
                    )
                      return;
                    discardExpenseEditorDraft(key);
                    setDrafts(readCorrectionDrafts(ownerId, group.id));
                  }}
                >
                  Discard draft…
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Sheet
        open={!!correction}
        onClose={closeCorrection}
        onDiscard={() => discardExpenseEditorDraft(draftKey)}
        title={entry ? 'Edit saved expense' : 'Review correction draft'}
        protectChanges
        {...(conflict ? { unsavedChanges: false } : {})}
        restoredChanges={restored}
        closeDisabled={saving}
      >
        {correction && (
          <>
            <div className="mb-4">
              {conflict ? (
                <FormError message={CORRECTION_CONFLICT} />
              ) : (
                <p className="text-sm text-muted">
                  Review who paid and who shared the cost, then save the corrected expense.
                </p>
              )}
            </div>
            {restored && !conflict && (
              <p role="status" className="mb-3 text-sm text-muted">
                Your unfinished correction is back.
              </p>
            )}
            <Form
              key={draftKey}
              groupId={group.id}
              ownerId={ownerId}
              members={group.members}
              correction={entry}
              correctionConflict={conflict}
              draftKey={draftKey}
              {...(draft && (entry && isEdit(entry) ? { editing: draft } : { template: draft }))}
              onPendingChange={setSaving}
              onCreated={(saved) => {
                closeCorrection();
                onSaved(saved);
              }}
              onQueued={() => {
                closeCorrection();
                toast.success('Corrected expense kept on this device. It will sync when you reconnect.');
              }}
            />
          </>
        )}
      </Sheet>
    </>
  );
}
