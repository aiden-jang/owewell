import type { MoneyFormatter } from '@owewell/shared';
import { PAYMENT_METHOD_LABELS } from '@owewell/core';
import { useState, type ReactNode } from 'react';
import type { SettlementReceiptData } from '../lib/settlementReceipt';
import { Icon } from './Icon';
import { useMoney } from '../lib/currency';

function balanceCopy(cents: number, fmt: MoneyFormatter): string {
  if (cents === 0) return 'settled up';
  return cents > 0 ? `owed ${fmt(cents)}` : `owes ${fmt(Math.abs(cents))}`;
}

export function SettlementReceipt({
  receipt,
  onClose,
  onUndo,
}: {
  receipt: SettlementReceiptData;
  onClose: () => void;
  onUndo?: () => Promise<void>;
}): ReactNode {
  const [undoing, setUndoing] = useState(false);
  const fmt = useMoney();
  const { settlement } = receipt;
  return (
    <section
      aria-labelledby="payment-receipt-title"
      className="mt-6 overflow-hidden rounded-2xl border border-pos/30 bg-pos/5 shadow-sm shadow-pos/5 animate-rise"
    >
      <div className="flex items-start gap-3 border-b border-pos/15 px-4 py-4">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pos text-[#07120a]"
        >
          <Icon name="check" size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            role="status"
            id="payment-receipt-title"
            className="text-xs font-semibold uppercase tracking-wide text-pos"
          >
            Payment recorded
          </p>
          <p className="mt-0.5 break-words font-display text-3xl font-semibold tracking-tight text-ink">
            {fmt(settlement.amountCents)}
          </p>
          <p className="mt-0.5 text-sm text-muted [overflow-wrap:anywhere]">
            {receipt.fromName} paid {receipt.toName}
            {settlement.method ? ` via ${PAYMENT_METHOD_LABELS[settlement.method]}` : ''}
          </p>
          <p className="mt-1 text-xs text-muted">Saved in owewell. No money was transferred by the app.</p>
          <time className="mt-1 block text-xs text-muted" dateTime={settlement.createdAt}>
            {new Date(settlement.createdAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'long',
            })}
          </time>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss payment receipt"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface2 hover:text-ink"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="grid gap-px bg-line sm:grid-cols-2">
        {receipt.changes.map((change) => (
          <div key={change.userId} className="bg-card px-4 py-3">
            <p className="text-xs font-medium text-muted [overflow-wrap:anywhere]">{change.name}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
              <span className="tnum text-faint line-through">{balanceCopy(change.beforeCents, fmt)}</span>
              <Icon name="arrow-right" size={13} className="text-faint" />
              <strong className={`tnum ${change.afterCents === 0 ? 'text-pos' : 'text-ink'}`}>
                {balanceCopy(change.afterCents, fmt)}
              </strong>
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs">
        <span className="text-muted">
          {receipt.clearedNames.length > 0
            ? `${receipt.clearedNames.join(' and ')} ${receipt.clearedNames.length === 1 ? 'is' : 'are'} clear`
            : 'Balances updated'}
        </span>
        <strong className={receipt.remainingTransfers === 0 ? 'text-pos' : 'text-ink'}>
          {receipt.remainingTransfers === 0
            ? 'Everyone is settled'
            : `${fmt(receipt.remainingCents)} left in ${receipt.remainingTransfers} ${receipt.remainingTransfers === 1 ? 'transfer' : 'transfers'}`}
        </strong>
      </div>
      {onUndo && (
        <div className="px-4 pb-3">
          <button
            type="button"
            disabled={undoing}
            className="min-h-11 rounded-lg border border-line px-4 text-sm font-medium text-ink hover:bg-surface2 disabled:opacity-50"
            onClick={async () => {
              if (undoing) return;
              setUndoing(true);
              try {
                await onUndo();
              } finally {
                setUndoing(false);
              }
            }}
          >
            {undoing ? 'Undoing…' : 'Undo this payment'}
          </button>
        </div>
      )}
    </section>
  );
}
