import { useState, type ReactNode } from 'react';
import { CategoryDot } from './CategoryMark';
import { SpendDonut } from './SpendDonut';
import { useMoney } from '../lib/currency';
import { lensTotal, spendByCategory as computeSpendByCategory } from '../lib/activityFilters';
import type { Expense } from '../lib/expenses';

/*
 * Where the money went, folded into the feed it filters.
 *
 * This used to be a section on a Summary tab, and tapping a category set a filter and threw you to
 * the other tab to see the result. That was the clearest sign the tab boundary was in the wrong
 * place: the chart and the list it filters are one interaction, so they live together now and the
 * filter applies where you are standing.
 *
 * Open, with no disclosure around it. It spent a while collapsed, which was a reasonable call when
 * the merge first put a budget card, a settle-by card and a monthly pulse on this page too and the
 * feed was a long way down. Those are all gone, so the argument went with them — and the same
 * section renders open on the public share link, which left the owner of a group hunting for a
 * chevron to see what a guest is shown outright.
 */

export function SpendBreakdown({
  expenses,
  categoryFilter,
  onSelectCategory,
}: {
  expenses: Expense[];
  categoryFilter: string | null;
  onSelectCategory: (key: string | null) => void;
}): ReactNode {
  const fmt = useMoney();
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
              className={`rounded-full px-2.5 py-0.5 font-medium capitalize transition ${
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
                  className={`-mx-2 flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface2 ${on ? 'bg-accent-soft' : ''}`}
                >
                  <span className={`w-28 shrink-0 truncate text-sm ${on ? 'font-medium text-accent' : ''}`}>
                    <CategoryDot categoryKey={meta.key} />{' '}
                    {meta.label}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">
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
                  <span className="tnum w-20 shrink-0 text-right text-sm text-muted">{fmt(cents)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
