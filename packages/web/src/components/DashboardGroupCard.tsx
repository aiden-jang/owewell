import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney as fmt, type MoneyFormatter } from '@owewell/shared';
import type { GroupSummary } from '../lib/groups';
import { timeAgoShort as timeAgo } from '../lib/relativeTime';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

function perGroupLabel(
  netCents: number,
  hasExpenses: boolean,
  groupHasUnsettled: boolean,
  fmt: MoneyFormatter,
): { text: string; className: string } {
  // No expenses yet isn't "settled" — there's just nothing owed. Show a neutral "no expenses".
  if (!hasExpenses) return { text: 'no expenses', className: 'text-faint' };
  // Net zero for the viewer doesn't mean the group is done: others may still owe each other.
  // "settled up" claims the whole group is clear; "you're square" is just the viewer's balance.
  if (netCents === 0)
    return { text: groupHasUnsettled ? "you're square" : 'settled up', className: 'text-muted' };
  const amount = fmt(Math.abs(netCents));
  return netCents > 0
    ? { text: `+${amount}`, className: 'text-pos' }
    : { text: `-${amount}`, className: 'text-neg' };
}

type Props = {
  group: GroupSummary;
  selectMode: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
};

export function DashboardGroupCard({ group, selectMode, selected, onToggle }: Props): ReactNode {
  const label = perGroupLabel(group.netCents, group.totalSpentCents > 0, group.totalUnsettledCents > 0, fmt);
  // Empty groups show their creation date; spending groups show the latest activity.
  const activity =
    group.totalSpentCents > 0 ? timeAgo(group.lastActivityAt) : `started ${timeAgo(group.createdAt)}`;
  const isSel = selected;
  const selecting = selectMode && !group.archived;
  const inner = (
    <>
      <span className="relative shrink-0">
        <Avatar name={group.name} />
        {selecting && isSel && (
          <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-ink ring-2 ring-canvas">
            <Icon name="check" size={12} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="group-card-title truncate font-medium">{group.name}</span>
          <span
            className={`group-card-balance tnum shrink-0 text-right text-sm font-semibold ${label.className}`}
          >
            {group.netCents !== 0 && (
              <span className="block text-xs font-normal text-muted">
                {group.netCents > 0 ? 'Owed to you' : 'You owe'}
              </span>
            )}
            {label.text}
          </span>
        </span>
        {/* Wrap metadata so narrow cards retain complete facts. */}
        <span className="group-card-meta block text-xs text-muted">
          {group.memberCount} {group.memberCount === 1 ? 'person' : 'people'}
          {activity && (
            <span className="text-faint">
              {' '}
              &middot; {group.totalSpentCents > 0 ? 'updated ' : ''}
              {activity}
            </span>
          )}
          {/* Dropped when it is only your own figure again, which is what it is whenever you are
                the group's sole creditor. */}
          {group.totalUnsettledCents > 0 && group.totalUnsettledCents !== Math.abs(group.netCents) && (
            <span className="tnum text-faint"> &middot; {fmt(group.totalUnsettledCents)} unsettled</span>
          )}
        </span>
      </span>
      {/* Keep the chevron slot in selection mode so names and dates stay aligned. */}
      <span className="grid w-[18px] shrink-0 place-items-center">
        {!selecting && <Icon name="chevron-right" size={18} className="text-faint" />}
      </span>
    </>
  );
  const cls = `group-card row-interactive surface flex min-h-[92px] items-center gap-4 rounded-2xl p-4 hover:shadow-lg hover:shadow-black/20 ${
    group.archived ? 'border-dashed' : ''
  } ${selecting && isSel ? 'ring-1 ring-accent' : ''}`;
  return (
    <li key={group.id}>
      {selecting ? (
        <button
          type="button"
          onClick={() => onToggle(group.id)}
          aria-pressed={isSel}
          className={`w-full text-left ${cls}`}
        >
          {inner}
        </button>
      ) : (
        <Link to={`/groups/${group.id}`} className={cls}>
          {inner}
        </Link>
      )}
    </li>
  );
}
