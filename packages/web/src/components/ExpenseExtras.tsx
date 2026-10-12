import type { ExpenseCategory } from '@owewell/core';
import { CategoryPicker } from './CategoryPicker';
import { DateField, NoteField } from './FormFields';

/** Optional metadata stays available without interrupting amount and split entry. */
export function ExpenseExtras({
  date,
  setDate,
  category,
  setCategory,
  note,
  setNote,
  expanded,
}: {
  date: string;
  setDate: (value: string) => void;
  category: ExpenseCategory;
  setCategory: (value: ExpenseCategory) => void;
  note: string;
  setNote: (value: string) => void;
  expanded: boolean;
}) {
  return (
    <details className="expense-extras" open={expanded}>
      <summary>Date, category & note</summary>
      <div className="space-y-3 pt-3">
        <label className="block text-xs text-muted">
          Date
          <DateField value={date} onChange={setDate} />
        </label>
        <CategoryPicker value={category} onChange={setCategory} />
        <NoteField value={note} onChange={setNote} />
      </div>
    </details>
  );
}
