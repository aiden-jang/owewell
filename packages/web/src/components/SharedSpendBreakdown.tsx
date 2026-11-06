import { useState } from 'react';
import { categoryMeta } from '@owewell/core';
import { formatMoney as fmt } from '@owewell/shared';
import type { SharedGroupSummary } from '../lib/groups';
import { CategoryDot } from './CategoryMark';
import { SpendDonut } from './SpendDonut';

export function SharedSpendBreakdown({
  breakdown,
  total,
}: {
  breakdown: SharedGroupSummary['breakdown'];
  total: number;
}) {
  const [breakdownView, setBreakdownView] = useState<'bars' | 'donut'>('bars');
  if (breakdown.length < 2 || total <= 0) return null;
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted">Where it went</h2>
        <div className="inline-flex rounded-full border border-line p-0.5 text-xs">
          {(['bars', 'donut'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setBreakdownView(v)}
              aria-pressed={breakdownView === v}
              className={`rounded-full px-2.5 py-0.5 font-medium capitalize transition ${
                breakdownView === v ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {breakdownView === 'donut' ? (
        <SpendDonut
          data={[...breakdown]
            .sort((a, b) => b.cents - a.cents)
            .map(({ category, cents }) => ({ meta: categoryMeta(category), cents }))}
          total={total}
        />
      ) : (
        <ul className="mt-3 space-y-2.5">
          {breakdown.map(({ category, cents }) => {
            const meta = categoryMeta(category);
            return (
              <li key={category}>
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    <CategoryDot categoryKey={meta.key} /> {meta.label}
                  </span>
                  <span className="tnum shrink-0 text-muted">{fmt(cents)}</span>
                </span>
                <span className="mt-1 block h-2 overflow-hidden rounded-full bg-surface2">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(3, Math.round((cents / total) * 100))}%`,
                      background: `var(--p-cat-${meta.key}, var(--p-accent))`,
                    }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
