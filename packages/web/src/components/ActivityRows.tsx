import type { ReactNode } from 'react';
import { PAYMENT_METHOD_LABELS } from '@owewell/core';
import type { Expense } from '../lib/expenses';
import type { Settlement } from '../lib/settlements';
import type { GroupMember } from '../lib/groups';
import { useMoney } from '../lib/currency';
import { timeAgoShort as timeAgo, dayAgo } from '../lib/relativeTime';
import { Avatar } from './Avatar';
import { CategoryGlyph } from './CategoryMark';
import { Icon } from './Icon';

export type Activity =
  | { kind: 'expense'; ts: number; expense: Expense }
  | { kind: 'settlement'; ts: number; settlement: Settlement };

type Props = {
  items: Activity[];
  members: GroupMember[];
  pendingEdits: Set<string>;
  onOpenExpense: (id: string) => void;
  onUndoSettlement: (id: string) => Promise<void>;
};

export function ActivityRows({
  items,
  members,
  pendingEdits,
  onOpenExpense,
  onUndoSettlement,
}: Props): ReactNode {
  const fmt = useMoney();
  const nameOf = (userId: string): string =>
    members.find((m) => m.userId === userId)?.displayName ?? 'Someone';
  // Who actually paid an expense. For itemized receipts we read the per-item payers
  // (falling back to the expense payer), so a split-tab receipt reads honestly instead
  // of crediting one person.
  // `who` is separate from " paid" so only the name truncates. Names vary without limit; the date
  // has to survive.
  function payerSummary(e: Expense): { avatar: string; who: string } {
    const payers =
      e.splitMethod === 'ITEMIZED' && e.items && e.items.length > 0
        ? [...new Set(e.items.map((i) => i.payerId ?? e.payerId))]
        : [e.payerId];
    const who =
      payers.length === 1
        ? nameOf(payers[0]!)
        : payers.length === 2
          ? `${nameOf(payers[0]!)} & ${nameOf(payers[1]!)}`
          : `${payers.length} people`;
    return { avatar: nameOf(payers[0]!), who };
  }

  return items.map((item, i) =>
    item.kind === 'expense' ? (
      <li
        key={`e-${item.expense.id}`}
        className="animate-rise"
        style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
      >
        {/* The whole row opens the detail sheet; every action lives in there. Row-level
                      icons are invisible on a phone and put delete next to the amount on desktop. */}
        <button
          type="button"
          onClick={() => onOpenExpense(item.expense.id)}
          aria-label={`${item.expense.description}, ${fmt(item.expense.amountCents)}. See details.`}
          className="expense-row flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-surface2"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={payerSummary(item.expense).avatar} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-semibold">
                <CategoryGlyph categoryKey={item.expense.category ?? 'other'} /> {item.expense.description}
              </p>
              <p className="mt-1 flex items-baseline text-xs text-muted">
                <span className="truncate">{payerSummary(item.expense).who}</span>
                {/* Real space, not a flex gap — a gap reads as "Alicepaid" to a screen
                              reader. */}
                <span className="shrink-0 whitespace-pre">
                  {' paid · '}
                  {dayAgo(item.expense.date)}
                  {/* Only flag when it wasn't shared with the whole group; "everyone" is
                                  the default, so printing it on every row would just be noise. */}
                  {item.expense.splits.length < members.length && ` · ${item.expense.splits.length} ways`}
                </span>
              </p>
              {/*
               * Not history — that lives on the expense itself. This says why the row
               * disagrees with what you typed, so it belongs next to the wrong number.
               */}
              {pendingEdits.has(item.expense.id) && (
                <p className="truncate text-xs text-faint">Your change is waiting for signal</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="tnum text-base font-semibold">{fmt(item.expense.amountCents)}</span>
            <Icon name="chevron-right" size={16} className="text-faint" />
          </div>
        </button>
      </li>
    ) : (
      <li
        key={`s-${item.settlement.id}`}
        className="animate-rise group flex items-center justify-between gap-3 px-4 py-3"
        style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-pos/30 bg-pos/10 text-pos">
            <Icon name="check" size={16} />
          </span>
          <div className="min-w-0">
            {/* Two names, neither expendable, but free wrapping runs to four lines. */}
            <p className="line-clamp-2 text-sm">
              <span className="font-medium">{nameOf(item.settlement.fromUserId)}</span>
              <span className="text-muted"> paid </span>
              <span className="font-medium">{nameOf(item.settlement.toUserId)}</span>
            </p>
            <p className="text-sm text-muted">
              {timeAgo(item.settlement.createdAt)}
              {item.settlement.method && ` · via ${PAYMENT_METHOD_LABELS[item.settlement.method]}`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="tnum font-medium text-pos">{fmt(item.settlement.amountCents)}</span>
          <button
            type="button"
            onClick={() => void onUndoSettlement(item.settlement.id)}
            aria-label="Undo payment"
            className="tap grid h-8 w-8 place-items-center rounded-full text-faint opacity-100 transition hover:bg-surface2 hover:text-neg [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
          >
            <Icon name="undo" size={15} />
          </button>
        </div>
      </li>
    ),
  );
}
