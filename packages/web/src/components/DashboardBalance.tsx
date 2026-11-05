import { formatMoney as fmt } from '@owewell/shared';
import type { ReactNode } from 'react';
import { ReceiptFace } from './ReceiptFace';
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
  const settled = totals.net === 0;
  const owed = totals.net > 0;
  return (
    <section className="overview-balance surface rounded-3xl p-6 sm:p-7">
      <ReceiptFace className="balance-receipt" />
      <p className="text-sm font-medium text-muted">
        {settled ? 'Across your active groups' : owed ? "You're owed, overall" : 'You owe, overall'}
      </p>
      <p
        className={`mt-1 font-display text-4xl font-extrabold tracking-tight sm:text-5xl ${fmt(Math.abs(totals.net)).length > 9 ? 'balance-amount-long' : ''} ${
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
        <dl className="overview-sides mt-4">
          <div>
            <dt className="text-muted">owed to you</dt>
            <dd className="tnum font-semibold text-pos">{fmt(totals.owed)}</dd>
          </div>
          <div>
            <dt className="text-muted">you owe</dt>
            <dd className="tnum font-semibold text-neg">{fmt(totals.owe)}</dd>
          </div>
        </dl>
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
