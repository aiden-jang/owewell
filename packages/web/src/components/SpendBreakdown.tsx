import { useState, type ReactNode } from 'react';
import { CategoryDot } from './CategoryDot';
import { Icon } from './Icon';
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
 * Closed by default, because the ledger below is what people came for. The summary line still says
 * something — the biggest category and its share — so a closed disclosure is not a dead row.
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
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'bars' | 'donut'>('bars');

  // Whole-group answers: the person lens belongs to the feed below, not to the spending shape.
  const byCategory = computeSpendByCategory(expenses, null, 'involved');
  const total = lensTotal(expenses, null, 'involved');

  // One category is not a breakdown, it is the total again with a bar under it.
  if (total <= 0 || byCategory.length < 2) return null;

  const biggest = byCategory[0]!;
  const share = Math.round((biggest.cents / total) * 100);
  const active = categoryFilter ? byCategory.find((c) => c.meta.key === categoryFilter) : null;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-2 text-left transition hover:text-ink"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm text-muted">
          Where it went
          {/* Closed, this is the whole point of the row: a fact, not just a label with a chevron. */}
          <span className="truncate text-xs text-faint">
            {active ? `${active.meta.label} · ${fmt(active.cents)}` : `mostly ${biggest.meta.label}, ${share}%`}
          </span>
        </span>
        <Icon name="chevron-right" size={15} className={`shrink-0 text-faint transition ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="animate-fade">
          <div className="flex justify-end">
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
        </div>
      )}
    </section>
  );
}
