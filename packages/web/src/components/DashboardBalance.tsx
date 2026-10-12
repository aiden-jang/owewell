import type { ReactNode } from 'react';
import { useMoney } from '../lib/currency';
import { MoneyText } from './MoneyText';

export function DashboardBalance({
  totals,
  hasAnySpend,
  othersStillOwe,
}: {
  totals: { owed: number; owe: number; net: number };
  hasAnySpend: boolean;
  othersStillOwe: boolean;
}): ReactNode {
  const fmt = useMoney();
  const settled = totals.net === 0;
  const owed = totals.net > 0;
  return (
    <section className="overview-balance surface rounded-3xl p-6 sm:p-7">
      <p className="text-sm font-medium text-muted">
        {settled ? 'Across your active groups' : owed ? "You're owed, overall" : 'You owe, overall'}
      </p>
      <p
        className={`mt-1 font-display text-4xl font-extrabold tracking-tight sm:text-5xl ${
          settled ? 'text-ink' : owed ? 'text-gradient' : 'text-neg'
        }`}
      >
        {settled && hasAnySpend ? (
          othersStillOwe ? (
            "You're square"
          ) : (
            'All settled'
          )
        ) : (
          <MoneyText cents={Math.abs(totals.net)} />
        )}
      </p>
      {/* Only when the two sides differ from the headline. Owed everywhere and owing nowhere
                prints the same figure twice, once as a headline and once as a chip beneath it. */}
      {totals.owed > 0 && totals.owe > 0 && (
        <div className="overview-sides mt-4 flex flex-wrap gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas/40 px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-pos" />
            <span className="text-muted">owed to you</span>
            <span className="tnum font-medium text-pos">{fmt(totals.owed)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas/40 px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-neg" />
            <span className="text-muted">you owe</span>
            <span className="tnum font-medium text-neg">{fmt(totals.owe)}</span>
          </span>
        </div>
      )}
      <p className="mt-4 text-sm text-muted">
        {totals.owed > 0 && totals.owe > 0
          ? 'The overall total combines both sides. Each group keeps its own balance.'
          : hasAnySpend
            ? othersStillOwe && settled
              ? 'Your balance is clear. Other members still have payments to record.'
              : 'Balances from active groups. Archived groups are excluded.'
            : 'Add your first expense in a group to start tracking balances.'}
      </p>
    </section>
  );
}
