import { type ReactNode } from 'react';
import { Icon } from './Icon';
import { MemberStrip } from './MemberStrip';
import { MoneyText } from './MoneyText';
import { SettledMark } from './SettledMark';
import { useToast } from './Toast';
import { useMoney } from '../lib/currency';
import { useShareAction } from '../lib/useShareAction';
import type { Balance, GroupMember } from '../lib/groups';
import type { Expense } from '../lib/expenses';
import type { Settlement, SuggestedPayment } from '../lib/settlements';

/*
 * Where you stand, before anything else on the page.
 *
 * One number and the smallest amount of context that keeps it honest: your position, what the group
 * still owes around you, how far the settling has got, and this month against last. Everything here
 * is derived from the four ledger arrays rather than passed in pre-chewed, because every one of
 * those numbers was only ever read here.
 *
 * Left-aligned while there is a number, centred once there isn't. A left edge is a column for
 * figures to line up on, and "You're square" is not a figure. Set in the same place at the same
 * size it read as a sentence abandoned in the corner, so the ending gets its own composition: the
 * mark, then the words, centred under it.
 */

export function BalanceHero({
  groupName,
  balances,
  expenses,
  settlements,
  suggested,
  currentUserId,
  members,
  onLogPayment,
  onOpenMembers,
}: {
  groupName: string;
  balances: Balance[];
  expenses: Expense[];
  settlements: Settlement[];
  /** Outstanding transfers. Empty means the whole group is clear, not just you. */
  suggested: SuggestedPayment[];
  currentUserId: string | undefined;
  members: GroupMember[];
  onLogPayment: () => void;
  onOpenMembers: () => void;
}): ReactNode {
  const fmt = useMoney();
  const toast = useToast();
  const memberCount = members.length;
  const { status: balanceShareStatus, share: shareBalance } = useShareAction(toast.error);

  const myNet = balances.find((b) => b.userId === currentUserId)?.netCents ?? 0;
  const settled = myNet === 0;
  const owed = myNet > 0;
  // A brand-new group has no expenses or payments yet, so it gets a "nothing yet" hero rather than
  // being congratulated for settling a tab it never opened.
  const hasActivity = expenses.length > 0 || settlements.length > 0;
  // You can be square while the group still has debts between others, so "all settled" is a
  // question about the outstanding transfers, not about your own balance.
  const groupSettled = suggested.length === 0;
  // The whole group's outstanding money: the sum of every positive balance, which equals what the
  // debtors owe since balances net to zero. Context, so "You're square" does not read as "we are
  // done" while other people still owe each other.
  const totalUnsettled = balances.reduce((sum, b) => sum + Math.max(0, b.netCents), 0);
  const totalSettled = settlements.reduce((sum, s) => sum + s.amountCents, 0);
  // Payments and the outstanding balance describe one journey toward zero. Clamped at 100 because a
  // manual payment can intentionally overpay an earlier split, and a bar past the end would make an
  // otherwise valid ledger look broken.
  const settlementJourney = totalSettled + totalUnsettled;
  const settlementProgress = settlementJourney > 0 ? Math.min(100, Math.round((totalSettled / settlementJourney) * 100)) : 0;

  function shareMyBalance(): void {
    if (myNet === 0) return;
    const amount = fmt(Math.abs(myNet));
    void shareBalance({
      title: `${groupName} balance`,
      text: myNet > 0
        ? `${groupName}: I’m owed ${amount}. Let’s get it settled in owewell.`
        : `${groupName}: I still owe ${amount}. I’ll send it over.`,
      failureMessage: 'Could not share your balance.',
    });
  }

  return (
      <div className={`surface rounded-3xl p-6 sm:p-7 ${settled ? 'text-center' : ''}`}>
        <MemberStrip members={members} onOpen={onOpenMembers} centered={settled} />
        {/* A group with nothing on it is not "settled", it just hasn't started. No mark for that. */}
        {hasActivity && settled && <SettledMark tone={groupSettled ? 'settled' : 'square'} />}
        <p className={`text-sm font-medium text-muted ${hasActivity && settled ? 'mt-4' : ''}`}>
          {!hasActivity
            ? memberCount < 2
              ? 'First, add the people'
              : 'Nothing on the tab yet'
            : settled
              ? groupSettled
                ? 'Everyone is clear'
                : 'Your standing here'
              : owed
                ? "You're owed"
                : 'You owe'}
        </p>
        <p
          className={`mt-1 font-display font-extrabold tracking-tight ${
            settled ? 'text-3xl sm:text-4xl' : 'text-5xl sm:text-6xl'
          } ${settled ? (hasActivity && groupSettled ? 'text-pos' : 'text-ink') : owed ? 'text-gradient' : 'text-neg'}`}
        >
          {!hasActivity ? (
            memberCount < 2 ? (
              'Just you so far'
            ) : (
              'Nothing yet'
            )
          ) : settled ? (
            groupSettled ? (
              'All settled'
            ) : (
              "You're square"
            )
          ) : (
            <MoneyText cents={Math.abs(myNet)} />
          )}
        </p>
        {/*
          * Only when the group's outstanding total is not just your own figure again.
          *
          * Whenever you are the sole creditor these two lines print the same number one under the
          * other, which reads as a rendering fault rather than as context. It is only telling you
          * something when other people owe each other too.
          */}
        {totalUnsettled > 0 && totalUnsettled !== Math.abs(myNet) && (
          <p className="mt-2 text-xs text-faint">
            {fmt(totalUnsettled)} still unsettled across the group
          </p>
        )}
        {totalSettled > 0 && (
          <p className="mt-1 text-xs text-faint">
            {fmt(totalSettled)} settled so far
          </p>
        )}
        {settlementJourney > 0 && (
          <div className={`mt-4 max-w-xs ${settled ? 'mx-auto' : ''}`}>
            <div className="mb-1.5 flex items-center justify-between text-xs text-faint">
              <span>settle-up progress</span>
              <span className="font-medium text-muted">{settlementProgress}%</span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-label="Settle-up progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={settlementProgress}
              aria-valuetext={`${settlementProgress}% of recorded settle-up payments complete`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-pos transition-[width] duration-500"
                style={{ width: `${settlementProgress}%` }}
              />
            </div>
          </div>
        )}
        {hasActivity && groupSettled && (
          <div className={`mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted ${settled ? 'justify-center' : ''}`}>
            <span>{expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'} · {settlements.length} {settlements.length === 1 ? 'payment' : 'payments'} recorded</span>
          </div>
        )}
        {/* One row, so the two links can't sit flush against each other when both are showing. */}
        <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${settled ? 'justify-center' : ''}`}>
        {hasActivity && !settled && (
          <button
            type="button"
            onClick={shareMyBalance}
            disabled={balanceShareStatus !== null}
            className="tap mt-4 inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-ink hover:underline disabled:cursor-default disabled:opacity-70"
          >
            <Icon name="share" size={13} />
            {balanceShareStatus === 'sharing' ? 'Opening…' : balanceShareStatus === 'shared' ? 'Balance shared' : balanceShareStatus === 'copied' ? 'Balance copied' : 'Send my balance'}
          </button>
        )}
        {!hasActivity ? (
          <p className="mt-4 text-sm text-muted">Add an expense to get the tab going.</p>
        ) : memberCount < 2 ? (
          <p className="mt-4 text-sm text-muted">Add someone else before you can log a payment.</p>
        ) : !groupSettled ? (
          <button
            type="button"
            onClick={onLogPayment}
            className="tap mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-ink hover:underline"
          >
            <Icon name="wallet" size={15} /> Log a payment
          </button>
        ) : null}
        </div>
      </div>
  );
}
