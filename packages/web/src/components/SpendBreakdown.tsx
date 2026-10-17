import { formatMoney as fmt } from '@owewell/shared';
import { useState, type ReactNode } from 'react';
import { CategoryDot } from './CategoryMark';
import { SpendDonut } from './SpendDonut';
import { lensTotal, spendByCategory as computeSpendByCategory } from '../lib/activityFilters';
import type { Expense } from '../lib/expenses';

export function SpendBreakdown({
  expenses,
  categoryFilter,
  onSelectCategory,
}: {
  expenses: Expense[];
  categoryFilter: string | null;
  onSelectCategory: (key: string | null) => void;
}): ReactNode {
  const [view, setView] = useState<'bars' | 'donut'>('bars');

  // Whole-group answers: the person lens belongs to the feed below, not to the spending shape.
  const byCategory = computeSpendByCategory(expenses, null, 'involved');
  const total = lensTotal(expenses, null, 'involved');

  // One category is not a breakdown, it is the total again with a bar under it.
  if (total <= 0 || byCategory.length < 2) return null;

  return (
    <section>
      {/* Heading and view switch on one line, the same arrangement the share page uses. */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted">Where it went</h2>
        <div className="inline-flex rounded-full border border-line p-0.5 text-xs">
          {(['bars', 'donut'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`tap rounded-full px-2.5 py-0.5 font-medium capitalize transition ${
                view === v ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {view === 'donut' ? (
        <SpendDonut data={byCategory} total={total} activeKey={categoryFilter} onSelect={onSelectCategory} />
      ) : (
        <ul className="mt-3 space-y-1">
          {byCategory.map(({ meta, cents }) => {
            const on = categoryFilter === meta.key;
            return (
              <li key={meta.key}>
                <button
                  type="button"
                  onClick={() => onSelectCategory(on ? null : meta.key)}
                  aria-pressed={on}
                  aria-label={`${on ? 'Clear filter' : 'Filter activity by'} ${meta.label}`}
                  className={`-mx-2 block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-surface2 ${on ? 'bg-accent-soft' : ''}`}
                >
                  {/*
                   * Label and figure above, bar across the full width below.
                   *
                   * These were three columns on one line: a 112px label, an 80px figure, and the
                   * bar taking whatever was left — about 105px on a 375px phone. The bar is the
                   * only part of the row you are actually comparing, and it was the smallest thing
                   * in it. Stacking costs a line per category and gives the comparison the width.
                   */}
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className={`min-w-0 truncate ${on ? 'font-medium text-accent' : ''}`}>
                      <CategoryDot categoryKey={meta.key} /> {meta.label}
                    </span>
                    <span className="tnum shrink-0 text-muted">{fmt(cents)}</span>
                  </span>
                  <span className="mt-1 block h-2 overflow-hidden rounded-full bg-surface2">
                    {/* The same hue the donut gives this category: one toggle should not change
                        what colour means. */}
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(3, Math.round((cents / total) * 100))}%`,
                        background: `var(--p-cat-${meta.key}, var(--p-accent))`,
                      }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
