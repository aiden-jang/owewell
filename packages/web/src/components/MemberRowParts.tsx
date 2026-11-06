import type { ReactNode } from 'react';
import type { MoneyFormatter } from '@owewell/shared';
import { Icon } from './Icon';

/** What a member's net position reads as on their row. Empty before the group has any activity. */
export function balanceLabel(
  netCents: number,
  hasActivity: boolean,
  fmt: MoneyFormatter,
): { text: string; tone: string } {
  // No expenses yet means nobody is settled OR unsettled — there's just nothing owed. Don't label
  // a brand-new member "settled up"; that only makes sense once there's been something to settle.
  if (!hasActivity) return { text: '', tone: 'text-muted' };
  if (netCents === 0) return { text: 'settled up', tone: 'text-muted' };
  const amount = fmt(Math.abs(netCents));
  return netCents > 0
    ? { text: `is owed ${amount}`, tone: 'text-pos' }
    : { text: `owes ${amount}`, tone: 'text-neg' };
}

/** One of the small pill buttons under a row, once its actions are open. */
export function RowAction({
  onClick,
  label,
  icon,
  danger = false,
}: {
  onClick: () => void;
  label: string;
  icon: 'pencil' | 'wallet' | 'x';
  danger?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tap inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium transition hover:border-line-strong hover:bg-surface2 ${
        danger ? 'text-neg' : 'text-muted hover:text-ink'
      }`}
    >
      <Icon name={icon} size={13} /> {label}
    </button>
  );
}
