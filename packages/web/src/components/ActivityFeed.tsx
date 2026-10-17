import { formatMoney as fmt } from '@owewell/shared';
import { CategoryGlyph } from './CategoryMark';
import { ActivityRows, type Activity } from './ActivityRows';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { categoryMeta, PAYMENT_METHOD_LABELS } from '@owewell/core';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';
import { lensAmount, matchesPersonLens } from '../lib/activityFilters';
import type { Expense } from '../lib/expenses';
import type { GroupMember } from '../lib/groups';
import type { Settlement } from '../lib/settlements';
import type { QueuedCreate, QueuedSettlement } from '../lib/outbox';

// Category selection is controlled because the spend chart also changes it.

/** How much of the feed renders before asking. Deep enough that most groups never see the button. */
const ACTIVITY_PAGE = 50;

type Relation = 'involved' | 'owes' | 'paid';

/** A queued create or settlement: the two kinds that carry enough to draw a row of their own. */
export type PendingRow = QueuedCreate | QueuedSettlement;

export function ActivityFeed({
  expenses,
  settlements,
  members,
  currentUserId,
  pendingRows,
  pendingDeletes,
  pendingEdits,
  categoryFilter,
  onCategoryFilter,
  onOpenExpense,
  onUndoSettlement,
  onAddExpense,
  breakdown,
}: {
  expenses: Expense[];
  settlements: Settlement[];
  members: GroupMember[];
  currentUserId: string | undefined;
  /** Writes that have not reached the server, shown above the ledger and not counted in it. */
  pendingRows: PendingRow[];
  /** Expense ids with a delete queued: their rows are already gone from the feed. */
  pendingDeletes: Set<string>;
  /** Expense ids with an edit queued: their rows say so rather than showing the unsent values. */
  pendingEdits: Set<string>;
  /** Controlled so the spend chart and feed share the category selection. */
  categoryFilter: string | null;
  onCategoryFilter: (key: string | null) => void;
  onOpenExpense: (expenseId: string) => void;
  onUndoSettlement: (settlementId: string) => Promise<void>;
  onAddExpense: () => void;
  /**
   * The spend breakdown, rendered under the filters.
   *
   * A slot rather than an import: the feed should not know what a donut is, and the chart it sits
   * above happens to drive the same category filter. Passing it in keeps that a page decision.
   */
  breakdown?: ReactNode;
}): ReactNode {
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [relationFilter, setRelationFilter] = useState<Relation>('involved');
  const [activityQuery, setActivityQuery] = useState('');

  const activity = useMemo<Activity[]>(() => {
    const items: Activity[] = [
      // A delete waiting to be sent hides its row. Without this the feed would show it again after a
      // reload — the server still has it — and the queue would delete it a second time on reconnect.
      ...expenses
        .filter((e) => !pendingDeletes.has(e.id))
        .map((e) => ({ kind: 'expense' as const, ts: new Date(e.date).getTime(), expense: e })),
      ...settlements.map((s) => ({
        kind: 'settlement' as const,
        ts: new Date(s.createdAt).getTime(),
        settlement: s,
      })),
    ];
    return items.sort((a, b) => b.ts - a.ts);
  }, [expenses, settlements, pendingDeletes]);

  // Person/category filters are expense-specific. Text search spans the entire ledger, including
  // payments, and matches the same human labels the rows display rather than internal ids.
  const visibleActivity = useMemo(() => {
    const query = activityQuery.trim().toLocaleLowerCase();
    const memberName = (userId: string): string =>
      members.find((member) => member.userId === userId)?.displayName ?? '';
    return activity.filter((item) => {
      if (categoryFilter || personFilter) {
        if (item.kind !== 'expense') return false;
        if (categoryFilter && (item.expense.category ?? 'other') !== categoryFilter) return false;
        if (!matchesPersonLens(item.expense, personFilter, relationFilter)) return false;
      }
      if (!query) return true;
      const haystack =
        item.kind === 'expense'
          ? [
              item.expense.description,
              categoryMeta(item.expense.category).label,
              memberName(item.expense.payerId),
              ...item.expense.splits.map((split) => memberName(split.userId)),
              fmt(item.expense.amountCents),
            ]
          : [
              memberName(item.settlement.fromUserId),
              memberName(item.settlement.toUserId),
              'payment',
              item.settlement.method ? PAYMENT_METHOD_LABELS[item.settlement.method] : '',
              fmt(item.settlement.amountCents),
            ];
      return haystack.some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [activity, activityQuery, categoryFilter, fmt, members, personFilter, relationFilter]);

  // Filter the complete ledger before bounding rendered rows so older matches remain searchable.
  const [showAll, setShowAll] = useState(false);
  const shownActivity = showAll ? visibleActivity : visibleActivity.slice(0, ACTIVITY_PAGE);
  const hiddenActivityCount = visibleActivity.length - shownActivity.length;

  // A new set of results is a new question, so it starts from the top again rather than dumping
  // every match of a two-letter search at once.
  useEffect(() => {
    setShowAll(false);
  }, [activityQuery, categoryFilter, personFilter, relationFilter]);

  function clearFilters(): void {
    setActivityQuery('');
    onCategoryFilter(null);
    setPersonFilter(null);
    setRelationFilter('involved');
  }

  // The person lens scopes the feed and the total above it; the category filter is a drill-down from
  // the spend chart. The lens logic is pure and unit-tested in lib/activityFilters.
  const lensActive = personFilter !== null;
  /*
   * Summed over what is on screen, not over what the person lens alone matches. `lensTotal` knows
   * about the person filter and nothing else, so a category filter would leave the heading showing
   * the whole ledger's total.
   */
  const visibleTotal = visibleActivity.reduce(
    (sum, item) =>
      item.kind === 'expense' ? sum + lensAmount(item.expense, personFilter, relationFilter) : sum,
    0,
  );
  const filtering = Boolean(activityQuery || categoryFilter || personFilter);
  const totalSpent = expenses.reduce((sum, e) => sum + e.amountCents, 0);
  const perPersonCents = members.length ? Math.round(totalSpent / members.length) : 0;

  return (
    <>
      {activity.length > 0 && breakdown}
      {/* Below the breakdown: these filter the list underneath, not the chart. */}
      {activity.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex min-w-[190px] flex-1 items-center gap-2 rounded-full border border-line bg-field px-3 py-1.5 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/10">
            <span className="sr-only">Search activity</span>
            <input
              type="search"
              value={activityQuery}
              onChange={(event) => setActivityQuery(event.target.value)}
              placeholder="Find dinner, Alex, $24…"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
            />
            {activityQuery && (
              <button
                type="button"
                onClick={() => setActivityQuery('')}
                aria-label="Clear activity search"
                className="text-muted transition hover:text-ink"
              >
                <Icon name="x" size={13} />
              </button>
            )}
          </label>
          {/* Capped: a select is as wide as its longest option, and one long name pushes the
              search field onto its own line. */}
          <select
            value={personFilter ?? ''}
            onChange={(e) => setPersonFilter(e.target.value || null)}
            aria-label="Filter by person"
            className={`max-w-[8.5rem] truncate rounded-full border px-3 py-2 font-medium outline-none transition focus:border-accent ${
              personFilter ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-field text-muted'
            }`}
          >
            <option value="">Anyone</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.userId === currentUserId ? 'You' : m.displayName}
              </option>
            ))}
          </select>
          {personFilter && (
            <select
              value={relationFilter}
              onChange={(e) => setRelationFilter(e.target.value as typeof relationFilter)}
              aria-label="Filter by relationship to the expense"
              className="rounded-full border border-accent bg-accent-soft px-3 py-2 font-medium text-accent outline-none transition focus:border-accent"
            >
              <option value="involved">involved</option>
              <option value="owes">owes</option>
              <option value="paid">paid</option>
            </select>
          )}
          {categoryFilter && (
            <button
              type="button"
              onClick={() => onCategoryFilter(null)}
              aria-label={`Clear ${categoryMeta(categoryFilter).label} filter`}
              className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent transition hover:bg-accent/15"
            >
              <CategoryGlyph categoryKey={categoryFilter} />
              {categoryMeta(categoryFilter).label}
              <Icon name="x" size={12} />
            </button>
          )}
          {filtering && (
            <>
              <span className="text-faint">
                {visibleActivity.length} {visibleActivity.length === 1 ? 'result' : 'results'}
              </span>
              <button
                type="button"
                onClick={clearFilters}
                className="text-muted underline-offset-2 transition hover:text-ink hover:underline"
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      <section className="mt-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Activity</h2>
          {visibleTotal > 0 && (
            <span className="tnum text-sm text-muted">
              {fmt(visibleTotal)}{' '}
              {lensActive
                ? relationFilter === 'owes'
                  ? 'owed'
                  : relationFilter === 'paid'
                    ? 'paid'
                    : 'spent'
                : 'spent'}
              {/* A whole-ledger average has no business beside a filtered total. */}
              {!filtering && perPersonCents > 0 && (
                <span className="text-faint"> · {fmt(perPersonCents)} avg/person</span>
              )}
            </span>
          )}
        </div>
        {/* Align the icon with the first line when the lock note wraps. */}
        {settlements.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-faint">
            <Icon name="undo" size={13} className="mt-0.5 shrink-0" />A payment&rsquo;s been recorded, so this
            is locked. Undo it below to edit or remove expenses.
          </p>
        )}
        {activity.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              tone="invite"
              icon="receipt"
              title="Nothing yet."
              body="No receipts. Suspiciously peaceful. Add one to start the tab."
              action={
                <button
                  type="button"
                  onClick={() => onAddExpense()}
                  data-focus-return="add-expense"
                  className="btn-gradient inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
                >
                  <Icon name="plus" size={15} /> Add expense
                </button>
              }
            />
          </div>
        ) : visibleActivity.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">
            Nothing in this ledger matches{activityQuery ? ` “${activityQuery.trim()}”` : ' these filters'}.{' '}
            <button type="button" onClick={clearFilters} className="font-medium text-accent hover:underline">
              Clear search and filters
            </button>
          </div>
        ) : (
          /* One panel with hairline rows, not a stack of cards: a ledger is a list of the same
             kind of thing, and per-row borders made it read as a pile of objects. */
          <ul className="activity-ledger panel mt-3">
            {/*
             * Queued writes sit above the ledger, dimmed and inert.
             *
             * They are not expenses yet, so they are deliberately not in the balances above and
             * say so: showing them as normal rows would mean the feed and the number at the top
             * of the page disagreed, with nothing on screen to explain why.
             */}
            {pendingRows.map((entry) => (
              <li
                key={entry.clientId}
                className="animate-rise flex items-center justify-between gap-3 border-b border-dashed border-line-strong px-4 py-3 opacity-70"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 animate-pulse place-items-center rounded-full bg-surface2 text-faint">
                    <Icon name="share" size={13} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-muted">{entry.description}</p>
                    <p className="truncate text-sm text-faint">Waiting for signal · not counted yet</p>
                  </div>
                </div>
                <span className="tnum shrink-0 font-semibold text-muted">{fmt(entry.amountCents)}</span>
              </li>
            ))}
            <ActivityRows
              items={shownActivity}
              members={members}
              pendingEdits={pendingEdits}
              onOpenExpense={onOpenExpense}
              onUndoSettlement={onUndoSettlement}
            />
          </ul>
        )}
        {hiddenActivityCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-3 w-full rounded-2xl border border-line py-2.5 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink"
          >
            Show {hiddenActivityCount} older {hiddenActivityCount === 1 ? 'entry' : 'entries'}
          </button>
        )}
      </section>
    </>
  );
}
