import { useState } from 'react';
import type { GroupDetail } from '../lib/groups';
import type { Expense } from '../lib/expenses';
import { Sheet } from './Sheet';
import { ExpenseDetail } from './ExpenseDetail';
import { AddExpenseForm } from './AddExpenseForm';
import { AddItemizedExpenseForm } from './AddItemizedExpenseForm';

type Props = {
  group: GroupDetail;
  detailExpense: Expense | null;
  viewerId: string | undefined;
  locked: boolean;
  onCloseDetail: () => void;
  onDelete: (id: string) => Promise<void>;
  onSaved: (saved: Expense, message: string) => void;
  onQueued: (description: string) => void;
};

/** The details-to-editor handoff retains the selected expense and its edit/duplicate mode. */
export function ExpenseEditorSheets({
  group,
  detailExpense,
  viewerId,
  locked,
  onCloseDetail,
  onDelete,
  onSaved,
  onQueued,
}: Props) {
  const [editor, setEditor] = useState<{ expense: Expense; mode: 'edit' | 'duplicate' } | null>(null);
  const itemized = editor?.expense.splitMethod === 'ITEMIZED';
  const Form = itemized ? AddItemizedExpenseForm : AddExpenseForm;
  const title =
    editor?.mode === 'duplicate'
      ? itemized
        ? 'Duplicate this receipt'
        : 'Duplicate this expense'
      : itemized
        ? 'Edit receipt'
        : 'Edit expense';
  const openEditor = (mode: 'edit' | 'duplicate') => {
    if (!detailExpense) return;
    setEditor({ expense: detailExpense, mode });
    onCloseDetail();
  };
  return (
    <>
      <Sheet open={!!detailExpense} onClose={onCloseDetail} title={detailExpense?.description ?? 'Expense'}>
        {detailExpense && (
          <ExpenseDetail
            expense={detailExpense}
            members={group.members}
            viewerId={viewerId}
            locked={locked}
            archived={group.archived}
            onEdit={() => openEditor('edit')}
            onDuplicate={() => openEditor('duplicate')}
            onDelete={() => void onDelete(detailExpense.id)}
          />
        )}
      </Sheet>
      <Sheet protectChanges open={!!editor} onClose={() => setEditor(null)} title={title}>
        {editor && (
          <>
            {editor.mode === 'duplicate' && (
              <p className="mb-4 text-sm text-muted">
                Everything is copied over with today&rsquo;s date. Change anything that was different this
                time.
              </p>
            )}
            <Form
              key={`${editor.mode}-${editor.expense.id}`}
              groupId={group.id}
              members={group.members}
              {...(editor.mode === 'edit' ? { editing: editor.expense } : { template: editor.expense })}
              onCreated={(saved) => {
                setEditor(null);
                onSaved(
                  saved,
                  editor.mode === 'edit'
                    ? itemized
                      ? 'Receipt updated.'
                      : 'Expense updated.'
                    : itemized
                      ? 'Added the receipt again.'
                      : 'Added it again.',
                );
              }}
              onQueued={(description) => {
                setEditor(null);
                onQueued(description);
              }}
            />
          </>
        )}
      </Sheet>
    </>
  );
}
