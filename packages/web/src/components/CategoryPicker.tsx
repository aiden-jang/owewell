import type { ReactNode } from 'react';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@owewell/core';

/**
 * A compact chip grid for picking an expense category. Shared by the simple and itemized
 * expense forms so both offer the same fixed set with matching styling.
 */
export function CategoryPicker({
  value,
  onChange,
}: {
  value: ExpenseCategory;
  onChange: (category: ExpenseCategory) => void;
}): ReactNode {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
      {EXPENSE_CATEGORIES.map((c) => {
        const active = c.key === value;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange(c.key)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
              active
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-line bg-field text-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            <span aria-hidden>{c.emoji}</span>
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
