import { useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';
import { AddExpenseForm } from './AddExpenseForm';
import { AddItemizedExpenseForm } from './AddItemizedExpenseForm';
import type { Expense } from '../lib/expenses';
import type { GroupMember } from '../lib/groups';

/*
 * Two ways to put something on the tab, behind one sheet.
 *
 * Which one you are using survives the sheet closing on purpose: somebody itemising one receipt is
 * usually about to itemise the next. The forms differ in what they ask for, not in what happens
 * after, so the callbacks are shared — `onCreated` is told which kind it was, because "added to the
 * tab" and "receipt added to the tab" are different news and the page owns the wording.
 */

export type ExpenseMode = 'simple' | 'itemized';

const BLURB: Record<ExpenseMode, string> = {
  simple: 'One amount for the whole group. Split evenly, or by custom amounts, shares, or percent.',
  itemized:
    'People ordered different things? Add each line item plus tax and tip, and we work out what everyone owes.',
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

  // Remounted when the roster changes: both forms seed their participant rows from the members they
  // were opened with, and a half-filled split that predates a new member is worse than a fresh one.
  const formProps = {
    key: `${mode}-${members.length}`,
    groupId,
    members,
    onCreated: (saved: Expense) => onCreated(saved, mode),
    onQueued,
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add to the tab" autoFocusField>
      <div className="mb-2.5 inline-flex w-full rounded-full border border-line bg-field p-1">
        {(['simple', 'itemized'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => setMode(option)}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition ${
              mode === option ? 'bg-surface2 shadow-sm text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {LABEL[option]}
          </button>
        ))}
      </div>
      <p className="mb-4 text-xs text-muted">{BLURB[mode]}</p>
      {mode === 'simple' ? <AddExpenseForm {...formProps} /> : <AddItemizedExpenseForm {...formProps} />}
    </Sheet>
  );
}
