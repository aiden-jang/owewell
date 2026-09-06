import type { Balance } from '@owewell/core';
import { frontingInsight } from '../lib/frontingInsight';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { useMoney } from '../lib/currency';

const SEGMENT_COLORS = ['#6d5ce7', '#eb7d5b', '#2f9b83', '#d49a36', '#4d82bd', '#bd658f'];

export function FrontingInsight({ balances, expenseCount }: { balances: Balance[]; expenseCount: number }) {
  const fmt = useMoney();
  const insight = frontingInsight(balances, expenseCount);
  if (!insight) return null;

  const headline = insight.concentrated
    ? `${insight.leader.displayName} has covered ${Math.round(insight.leader.percent)}% so far`
    : 'No one has carried most of the tab';

  return (
    <details className="group overflow-hidden rounded-2xl border border-line bg-card/70 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
            <Icon name="sparkles" size={15} />
          </span>
          <span className="min-w-0">
            <strong className="block text-sm font-semibold text-ink">Who&rsquo;s been fronting?</strong>
            <span className="block truncate text-xs text-muted">{headline}</span>
          </span>
        </span>
        <Icon
          name="chevron-right"
          size={16}
          className="shrink-0 text-faint transition-transform group-open:rotate-90"
        />
      </summary>

      <div className="border-t border-line px-4 pb-4 pt-3">
        <div
          className="flex h-2.5 overflow-hidden rounded-full bg-line"
          role="img"
          aria-label={insight.shares
            .map((share) => `${share.displayName} covered ${Math.round(share.percent)}%`)
            .join(', ')}
        >
          {insight.shares.map((share, index) => (
            <span
              key={share.userId}
              style={{
                width: `${share.percent}%`,
                backgroundColor: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
              }}
            />
          ))}
        </div>

        <ul className="mt-3 space-y-2">
          {insight.shares.map((share, index) => (
            <li key={share.userId} className="flex items-center gap-2 text-xs">
              <Avatar name={share.displayName} size="sm" />
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{share.displayName}</span>
              <span className="tnum text-muted">{fmt(share.paidCents)}</span>
              <span
                className="tnum w-9 text-right font-semibold"
                style={{ color: SEGMENT_COLORS[index % SEGMENT_COLORS.length] }}
              >
                {Math.round(share.percent)}%
              </span>
            </li>
          ))}
        </ul>

        {insight.concentrated && insight.nextPayer && (
          <p className="mt-3 rounded-xl bg-accent-soft px-3 py-2.5 text-xs leading-relaxed text-accent">
            <strong>{insight.leader.displayName}</strong> has been doing the card work. Maybe let{' '}
            <strong>{insight.nextPayer.displayName}</strong> grab the next one.
          </p>
        )}
      </div>
    </details>
  );
}
