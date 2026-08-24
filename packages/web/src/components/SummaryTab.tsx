import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { SpendDonut } from './SpendDonut';
import { TripBudget } from './TripBudget';
import { FrontingInsight } from './FrontingInsight';
import { useToast } from './Toast';
import { useMoney } from '../lib/currency';
import { lensTotal as computeLensTotal, spendByCategory as computeSpendByCategory } from '../lib/activityFilters';
import { tripBudget } from '../lib/tripBudget';
import type { GroupRecap } from '../lib/groupRecap';
import type { Balance, GroupMember } from '../lib/groups';
import type { Expense } from '../lib/expenses';
import type { Settlement } from '../lib/settlements';

/*
 * The tab, read back to you: what it came to, where it went, and how it sat against the budget.
 *
 * Everything here answers a question about the group as a whole, so nothing in it takes the person
 * lens the feed uses — the breakdown is deliberately computed unfiltered. Two bits of state came
 * with it, both about how you are looking rather than what you are looking at: bars or donut, and
 * whether the recap is mid-share.
 *
 * The recap itself is passed in rather than built here. The Balances tab needs to know whether one
 * exists so it can offer the link across, and computing it twice to answer the same question in two
 * places is how the two ends drift apart.
 */

export function SummaryTab({
  groupName,
  recap,
  expenses,
  settlements,
  balances,
  members,
  budgetCents,
  isOwner,
  categoryFilter,
  onSelectCategory,
  onSaveBudget,
}: {
  groupName: string;
  /** Non-null only once the group is settled and has something to look back on. */
  recap: GroupRecap | null;
  expenses: Expense[];
  settlements: Settlement[];
  balances: Balance[];
  members: GroupMember[];
  budgetCents: number | null;
  isOwner: boolean;
  /** Which slice is already driving the feed. Owned by the page, since both tabs read it. */
  categoryFilter: string | null;
  /**
   * Drills from the chart into the feed, which means switching tabs. Called with null when the
   * active slice is picked again: the label on that button says it clears the filter, so it has to.
   */
  onSelectCategory: (key: string | null) => void;
  onSaveBudget: (budgetCents: number | null) => Promise<void>;
}): ReactNode {
  const fmt = useMoney();
  const toast = useToast();
  const [breakdownView, setBreakdownView] = useState<'bars' | 'donut'>('bars');
  const [recapShareStatus, setRecapShareStatus] = useState<'sharing' | 'shared' | 'copied' | null>(null);

  /*
   * Everything the group has spent against the number it set, not just this month.
   *
   * A trip budget is a total for one trip, so unlike the monthly pulse on the Balances tab it must
   * not reset on the 1st. Members rather than balances is the right divisor: a person who has paid
   * for nothing still spent.
   */
  const budget = tripBudget(budgetCents, expenses, members.length);
  // Whole-group answers. The person lens belongs to the feed it sits above, not to the summary.
  const spendByCategory = computeSpendByCategory(expenses, null, 'involved');
  const spendTotal = computeLensTotal(expenses, null, 'involved');

  // The final payment is a natural handoff point: someone usually wants to tell the group that
  // nothing is hanging over them anymore. Keep the recap factual and compact so it is useful in a
  // group chat without exposing the individual balance history again.
  async function shareSettledRecap(): Promise<void> {
    if (!recap || recapShareStatus) return;
    const paymentLabel = settlements.length === 1 ? 'payment' : 'payments';
    const highlights = [
      recap.topCategory ? `Top category: ${recap.topCategory.emoji} ${recap.topCategory.label} (${fmt(recap.topCategory.amountCents)})` : null,
      recap.largest ? `Biggest expense: ${recap.largest.description} (${fmt(recap.largest.amountCents)})` : null,
      recap.daysOpen ? `Tab open for ${recap.daysOpen} ${recap.daysOpen === 1 ? 'day' : 'days'}` : null,
    ].filter(Boolean).join('\n');
    const text = `${groupName} is all settled ✓\n${fmt(recap.totalCents)} split across ${members.length} people\n${settlements.length} ${paymentLabel} recorded${highlights ? `\n\n${highlights}` : ''}`;
    const finish = (status: 'shared' | 'copied'): void => {
      setRecapShareStatus(status);
      window.setTimeout(() => setRecapShareStatus(null), 2200);
    };
    setRecapShareStatus('sharing');
    if (navigator.share) {
      try {
        await navigator.share({ title: `${groupName} is settled`, text });
        finish('shared');
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setRecapShareStatus(null);
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      finish('copied');
    } catch {
      setRecapShareStatus(null);
      toast.error('Could not share the settled recap.');
    }
  }

  return (
    <>
        {recap && (
          <section className="mt-4 overflow-hidden rounded-3xl border border-accent/15 bg-gradient-to-br from-accent-soft/80 via-surface to-surface2 p-5 shadow-sm shadow-accent/5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">The tab, wrapped</p>
                <h2 className="mt-1 font-display text-xl font-bold text-ink">{groupName} in four numbers</h2>
                <p className="mt-1 text-sm text-muted">Nothing left to chase. Just the story of the tab.</p>
              </div>
              <span aria-hidden className="text-2xl text-accent">✦</span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-2xl border border-line/70 bg-surface/70 p-3">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-faint">Total spent</span>
                <strong className="mt-1 block font-display text-lg text-ink">
                  {fmt(recap.totalCents)}
                </strong>
              </div>
              <div className="min-w-0 rounded-2xl border border-line/70 bg-surface/70 p-3">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-faint">Biggest moment</span>
                <strong className="mt-1 block truncate text-sm text-ink" title={recap.largest?.description}>
                  {recap.largest?.description ?? 'nothing yet'}
                </strong>
                {recap.largest && (
                  <span className="mt-0.5 block text-xs text-muted">{fmt(recap.largest.amountCents)}</span>
                )}
              </div>
              <div className="rounded-2xl border border-line/70 bg-surface/70 p-3">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-faint">Top category</span>
                <strong className="mt-1 block text-sm text-ink">
                  {recap.topCategory ? `${recap.topCategory.emoji} ${recap.topCategory.label}` : 'nothing yet'}
                </strong>
                {recap.topCategory && (
                  <span className="mt-0.5 block text-xs text-muted">{fmt(recap.topCategory.amountCents)}</span>
                )}
              </div>
              <div className="rounded-2xl border border-line/70 bg-surface/70 p-3">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-faint">Tab lifetime</span>
                <strong className="mt-1 block font-display text-lg text-ink">
                  {recap.daysOpen} {recap.daysOpen === 1 ? 'day' : 'days'}
                </strong>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void shareSettledRecap()}
              disabled={recapShareStatus !== null}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent-soft px-3.5 py-2 text-sm font-semibold text-accent transition hover:border-accent/35 hover:bg-accent/10 active:scale-[0.98] disabled:cursor-default disabled:opacity-70"
            >
              <Icon name="share" size={14} />
              {recapShareStatus === 'sharing' ? 'Opening…' : recapShareStatus === 'shared' ? 'Wrapped shared' : recapShareStatus === 'copied' ? 'Wrapped copied' : 'Share the wrapped tab'}
            </button>
          </section>
        )}

          <div className="mt-4">
            <TripBudget
              budget={budget}
              budgetCents={budgetCents}
              isOwner={isOwner}
              onSave={onSaveBudget}
            />
          </div>

        {expenses.length > 0 && members.length > 1 && (
          <FrontingInsight balances={balances} expenseCount={expenses.length} />
        )}

        {spendTotal > 0 && spendByCategory.length > 1 && (
          <section className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-muted">Where it went</h2>
              <div className="flex items-center gap-2">
                {!categoryFilter && <span className="text-xs text-faint">tap to see them</span>}
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
            </div>
            {breakdownView === 'donut' ? (
              <SpendDonut
                data={spendByCategory}
                total={spendTotal}
                activeKey={categoryFilter}
                onSelect={onSelectCategory}
              />
            ) : (
            <ul className="mt-3 space-y-1">
              {spendByCategory.map(({ meta, cents }) => {
                const active = categoryFilter === meta.key;
                return (
                  <li key={meta.key}>
                    <button
                      type="button"
                      onClick={() => onSelectCategory(active ? null : meta.key)}
                      aria-pressed={active}
                      aria-label={`${active ? 'Clear filter' : 'Filter activity by'} ${meta.label}`}
                      className={`-mx-2 flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface2 ${active ? 'bg-accent-soft' : ''}`}
                    >
                      <span className={`w-28 shrink-0 truncate text-sm ${active ? 'font-medium text-accent' : ''}`}>
                        <span aria-hidden className="mr-1.5">
                          {meta.emoji}
                        </span>
                        {meta.label}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${Math.max(3, Math.round((cents / spendTotal) * 100))}%` }}
                        />
                      </span>
                      <span className="tnum w-20 shrink-0 text-right text-sm text-muted">
                        {fmt(cents)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            )}
          </section>
        )}
    </>
  );
}
