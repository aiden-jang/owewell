import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useConfirm } from './Confirm';
import { Sheet } from './Sheet';
import { AddExpenseForm } from './AddExpenseForm';
import { AddItemizedExpenseForm } from './AddItemizedExpenseForm';
import type { Expense } from '../lib/expenses';
import type { GroupMember } from '../lib/groups';

// Preserve the chosen entry mode when the sheet closes.

export type ExpenseMode = 'simple' | 'itemized';

const BLURB: Record<ExpenseMode, string> = {
  simple: 'One total, split equally or your way.',
  itemized: 'Each item goes to the people who had it. Add tax and tip below.',
};

const LABEL: Record<ExpenseMode, string> = {
  simple: 'Split a total',
  itemized: 'Itemize a receipt',
};

export function AddExpenseSheet({
  open,
  onClose,
  groupId,
  members,
  onCreated,
  onQueued,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
  members: GroupMember[];
  onCreated: (saved: Expense, mode: ExpenseMode) => void;
  /** It could not be sent, so it is in the outbox under this description. */
  onQueued: (description: string) => void;
}): ReactNode {
  const [mode, setMode] = useState<ExpenseMode>('simple');
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  const confirm = useConfirm();
  useEffect(() => {
    if (!open) dirty.current = false;
  }, [open]);
  async function switchMode(option: ExpenseMode): Promise<void> {
    if (option === mode || saving) return;
    if (
      dirty.current &&
      !(await confirm({
        title: 'Switch expense format?',
        body: 'This discards the unfinished entry. Nothing has been added to the group.',
        confirmLabel: 'Discard and switch',
        cancelLabel: 'Keep editing',
      }))
    )
      return;
    dirty.current = false;
    setMode(option);
  }

  // Remounted when the roster changes: both forms seed their participant rows from the members they
  // were opened with, and a half-filled split that predates a new member is worse than a fresh one.
  const formProps = {
    key: `${groupId}-${mode}-${members.length}`,
    groupId,
    members,
    onCreated: (saved: Expense) => onCreated(saved, mode),
    onQueued,
    onPendingChange: setSaving,
  };

  return (
    <Sheet key={mode} open={open} onClose={onClose} title="Add to the tab" autoFocusField protectChanges>
      <div className="expense-mode mb-2.5 inline-flex w-full rounded-full border border-line bg-field p-1">
        {(['simple', 'itemized'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => void switchMode(option)}
            disabled={saving}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition ${
              mode === option ? 'bg-surface2 shadow-sm text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {LABEL[option]}
          </button>
        ))}
      </div>
      <p className="mb-4 text-xs text-muted">{BLURB[mode]}</p>
      <div
        onChangeCapture={() => {
          dirty.current = true;
        }}
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('button[aria-pressed]')) dirty.current = true;
        }}
      >
        {mode === 'simple' ? <AddExpenseForm {...formProps} /> : <AddItemizedExpenseForm {...formProps} />}
      </div>
    </Sheet>
  );
}
