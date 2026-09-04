import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useDashboardMode } from './useDashboardMode.js';
import { Link, useNavigate } from 'react-router-dom';
import { type MoneyFormatter } from '@owewell/shared';
import { useMoney } from '../lib/currency';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { MoneyText } from '../components/MoneyText';
import { SkeletonList } from '../components/Skeleton';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { groupsApi, type GroupSummary } from '../lib/groups';
import { clearPendingSplit, loadPendingSplit, quickSplitApi } from '../lib/quicksplit';
import { queued } from '../lib/outbox';
import { useOutboxSync } from '../lib/useOutboxSync';
import { timeAgoShort as timeAgo } from '../lib/relativeTime.js';

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

export function DashboardPage(): ReactNode {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [waiting, setWaiting] = useState(() => queued().length);
  // Distinguish a failed load from a genuinely empty account: null = loading, [] = empty,
  // loadError = the fetch failed (show a retry, not the cheerful "no groups" state).
  const [loadError, setLoadError] = useState(false);
  const fmt = useMoney();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(() => loadPendingSplit());
  const [savingPending, setSavingPending] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const mode = useDashboardMode(() => setError(null));
  const {
    creatingOpen,
    name,
    setName,
    nameTouched,
    touchName,
    openCreate,
    closeCreate,
    selectMode,
    selected,
    toggleSelected,
    enterSelect,
    exitSelect,
  } = mode;

  async function onBulkArchive(): Promise<void> {
    const ids = [...selected];
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) => groupsApi.setArchived(id, true)));
      setGroups((prev) => (prev ?? []).map((g) => (selected.has(g.id) ? { ...g, archived: true } : g)));
      toast.success(`Archived ${ids.length} ${ids.length === 1 ? 'group' : 'groups'}.`);
    } catch {
      toast.error('Could not archive some of those.');
    } finally {
      setBulkBusy(false);
    }
    exitSelect();
  }

  async function onBulkDelete(): Promise<void> {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Delete ${ids.length} ${ids.length === 1 ? 'group' : 'groups'}?`,
      body: 'This permanently removes them for everyone. It can’t be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok || bulkBusy) return;
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) => groupsApi.remove(id)));
      setGroups((prev) => (prev ?? []).filter((g) => !selected.has(g.id)));
      toast.success(`Deleted ${ids.length} ${ids.length === 1 ? 'group' : 'groups'}.`);
    } catch {
      toast.error('Could not delete some of those.');
    } finally {
      setBulkBusy(false);
    }
    exitSelect();
  }

  const loadGroups = useCallback(() => {
    setLoadError(false);
    setGroups(null);
    groupsApi
      .list()
      .then(setGroups)
      .catch(() => {
        setLoadError(true);
        toast.error('Could not load your groups.');
      });
  }, [toast]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  /*
   * The whole queue, not one group's worth.
   *
   * This is the screen you land on, and the group page can only drain its own group. Without this,
   * an expense added to one tab on a train would sit in localStorage for as long as you kept opening
   * a different tab, while the totals above quietly left it out.
   */
  useOutboxSync({
    onChanged: () => loadGroups(),
    onQueueChanged: () => setWaiting(queued().length),
  });

  // One pair of totals, over the unarchived groups.
  const totals = useMemo(() => {
    let owed = 0;
    let owe = 0;
    for (const g of (groups ?? []).filter((x) => !x.archived)) {
      if (g.netCents > 0) owed += g.netCents;
      if (g.netCents < 0) owe -= g.netCents;
    }
    return { owed, owe, net: owed - owe };
  }, [groups]);

  async function savePending(): Promise<void> {
    if (!pending) return;
    setSavingPending(true);
    try {
      const { groupId } = await quickSplitApi.save(pending);
      clearPendingSplit();
      setPending(null);
      navigate(`/groups/${groupId}`);
    } catch {
      setSavingPending(false);
      toast.error('Could not save that split. Give it another go.');
    }
  }

  function dismissPending(): void {
    clearPendingSplit();
    setPending(null);
  }

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    // Used to return silently, so pressing Create with an empty field looked like the app had frozen.
    if (!name.trim()) {
      touchName();
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const group = await groupsApi.create(name.trim());
      setGroups((prev) => [
        {
          id: group.id,
          name: group.name,
          createdAt: group.createdAt,
          archived: false,
          memberCount: group.members.length,
          netCents: 0,
          totalUnsettledCents: 0,
          totalSpentCents: 0,
          lastActivityAt: group.createdAt,
          isOwner: true,
        },
        ...(prev ?? []),
      ]);
      closeCreate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that group.');
    } finally {
      setCreating(false);
    }
  }

  const settled = totals.net === 0;
  const owed = totals.net > 0;
  const activeGroups = (groups ?? []).filter((g) => !g.archived);
  const archivedGroups = (groups ?? []).filter((g) => g.archived);
  // "All settled" only makes sense once there's been spending somewhere; a set of brand-new,
  // expense-free groups nets to zero but isn't "settled".
  const hasAnySpend = activeGroups.some((g) => g.totalSpentCents > 0);
  // You can net to zero yourself while other members still owe each other. In that case say
  // "You're square" (your balance), not "All settled" (which claims the whole group is done).
  const othersStillOwe = activeGroups.some((g) => g.totalUnsettledCents > 0);
  const selectedGroups = (groups ?? []).filter((g) => selected.has(g.id));
  const allOwned = selectedGroups.length > 0 && selectedGroups.every((g) => g.isOwner);

  // `selectable` rows become tap-to-select in select mode; archived rows stay plain links.
  const groupRow = (group: GroupSummary, selectable = true): ReactNode => {
    const label = perGroupLabel(
      group.netCents,
      group.totalSpentCents > 0,
      group.totalUnsettledCents > 0,
      fmt,
    );
    // Last activity, not creation date: it answers "is this still going on", which is the only date
    // question a dashboard row raises. A group with no expenses yet says when it was started.
    //
    // Short form, as in the feed. "3 people · 4 days ago" did not fit beside the amount at 375px and
    // truncated to "3 people · 4 d...", which spends a line saying nothing. Four characters shorter
    // is the whole fix.
    const activity =
      group.totalSpentCents > 0 ? timeAgo(group.lastActivityAt) : `started ${timeAgo(group.createdAt)}`;
    const isSel = selected.has(group.id);
    const selecting = selectMode && selectable;
    const inner = (
      <>
        <span className="relative shrink-0">
          <Avatar name={group.name} />
          {selecting && isSel && (
            <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-accent text-white ring-2 ring-canvas">
              <Icon name="check" size={12} />
            </span>
          )}
        </span>
        {/* Primary facts on the first line, secondary facts together on the second. Sharing a
            column with the amount, the meta line always loses: "3 people · 4 d…" tells you nothing.
            Same shape as a member row, deliberately. */}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate font-medium">{group.name}</span>
            <span className={`tnum shrink-0 text-sm font-semibold ${label.className}`}>{label.text}</span>
          </span>
          {/* xs and wrapping. At sm these three facts overflowed by 13px at 375px and clipped
              "$90.00 unsettled"; xs alone only moves the cliff. A name can be cut and still read as
              a cut name, but a list of facts with one severed mid-word says less than two facts. */}
          <span className="block text-xs text-muted">
            {group.memberCount} {group.memberCount === 1 ? 'person' : 'people'}
            {activity && <span className="text-faint"> &middot; {activity}</span>}
            {/* Dropped when it is only your own figure again, which is what it is whenever you are
                the group's sole creditor. */}
            {group.totalUnsettledCents > 0 && group.totalUnsettledCents !== Math.abs(group.netCents) && (
              <span className="tnum text-faint"> &middot; {fmt(group.totalUnsettledCents)} unsettled</span>
            )}
          </span>
        </span>
        {/*
          The chevron's SLOT is always here, even in select mode. Hiding the icon outright reflowed
          every row, so entering select mode made all the names and dates jump sideways — the most
          noticeable thing on the screen on a phone.
        */}
        <span className="grid w-[18px] shrink-0 place-items-center">
          {!selecting && <Icon name="chevron-right" size={18} className="text-faint" />}
        </span>
      </>
    );
    const cls = `row-interactive surface flex items-center gap-4 rounded-2xl p-4 hover:shadow-lg hover:shadow-black/20 ${
      group.archived ? 'opacity-60' : ''
    } ${selecting && isSel ? 'ring-1 ring-accent' : ''}`;
    return (
      <li key={group.id}>
        {selecting ? (
          <button
            type="button"
            onClick={() => toggleSelected(group.id)}
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
  };

  return (
    <div className="flex-1">
      <AppHeader />
      <main
        id="main"
        tabIndex={-1}
        className={`mx-auto w-full max-w-2xl animate-rise px-4 py-8 ${selectMode ? 'pb-28' : ''}`}
      >
        {pending && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3">
            <span className="flex items-center gap-2 text-sm">
              <Icon name="sparkles" size={16} className="text-accent" />
              You left a split lying around:{' '}
              <span className="font-medium">
                {pending.items[0]?.description || 'Quick split'}
                {pending.items.length > 1 ? ` +${pending.items.length - 1} more` : ''}
              </span>
              .
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void savePending()}
                disabled={savingPending}
                className="btn-gradient rounded-full px-3.5 py-1.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-60"
              >
                {savingPending ? 'Saving…' : 'Save it'}
              </button>
              <button
                type="button"
                onClick={dismissPending}
                className="rounded-full border border-line px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Said here because the totals below do not include it: a queued write is not in anybody's
            balance until it lands. */}
        {waiting > 0 && (
          <p className="mb-4 flex items-center justify-center gap-2 rounded-full border border-dashed border-line-strong py-2 text-sm text-muted">
            <Icon name="share" size={14} />
            {waiting === 1 ? 'One change is waiting for signal' : `${waiting} changes are waiting for signal`}
          </p>
        )}

        {/* Nothing to total before there is a group: an account on its first day was being shown a
            $0.00 the size of a headline, above an empty state that already says the same thing. */}
        {activeGroups.length > 0 && (
          <section className="surface rounded-3xl p-6 sm:p-7">
            <p className="text-sm font-medium text-muted">
              {settled ? 'Across all your groups' : owed ? "You're owed, overall" : 'You owe, overall'}
            </p>
            {/* A step below the group page's 5xl/6xl figure. The larger type belongs to the number
                you can act on; this one is a roll-up you can only open. */}
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
              <div className="mt-4 flex flex-wrap gap-2 text-sm">
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
          </section>
        )}

        <div className="mt-8 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold tracking-tight">Your groups</h2>
          <div className="flex items-center gap-2">
            {selectMode ? (
              <button
                type="button"
                onClick={exitSelect}
                className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-3.5 py-1.5 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
              >
                Cancel
              </button>
            ) : (
              <>
                {activeGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={enterSelect}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-3.5 py-1.5 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
                  >
                    <Icon name="check" size={16} /> Select
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (creatingOpen ? closeCreate() : openCreate())}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-3.5 py-1.5 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
                >
                  <Icon name="plus" size={16} /> New
                </button>
              </>
            )}
          </div>
        </div>

        {creatingOpen && (
          <form onSubmit={(e) => void onCreate(e)} className="mt-3">
            <div className="flex gap-2">
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => touchName()}
                onKeyDown={(e) => e.key === 'Escape' && closeCreate()}
                aria-invalid={nameTouched && !name.trim()}
                aria-describedby="group-name-hint"
                placeholder="Tahoe trip, apartment 4B, book club..."
                className={`flex-1 rounded-xl border bg-field px-3.5 py-2.5 outline-none transition focus:ring-2 focus:ring-accent/20 ${
                  nameTouched && !name.trim() ? 'border-neg' : 'border-line focus:border-accent'
                }`}
              />
              {/* Right here rather than buried in settings: it is a two-second choice when the group
                  is a trip, and an annoying correction once the first expense is in. */}
              <button
                type="submit"
                disabled={creating || !name.trim()}
                className="btn-gradient rounded-full px-5 py-2.5 font-semibold transition active:scale-[0.98] disabled:opacity-60"
              >
                {creating ? 'Adding…' : 'Create'}
              </button>
            </div>
            <p
              id="group-name-hint"
              className={`mt-1.5 text-sm ${nameTouched && !name.trim() ? 'font-medium text-neg' : 'text-faint'}`}
            >
              {nameTouched && !name.trim()
                ? 'Give the group a name to create it.'
                : 'Name it after the trip, the flat, or the people.'}
            </p>
          </form>
        )}
        {error && <p className="mt-2 text-sm font-medium text-neg">{error}</p>}

        <div className="mt-4">
          {loadError ? (
            <EmptyState
              tone="problem"
              icon="users"
              title="Couldn't load your groups."
              body="Probably a hiccup on our end, not you."
              action={
                <Button variant="secondary" onClick={loadGroups}>
                  Try again
                </Button>
              }
            />
          ) : groups === null ? (
            <SkeletonList rows={3} />
          ) : activeGroups.length === 0 && archivedGroups.length === 0 ? (
            <EmptyState
              tone="invite"
              icon="users"
              title="No groups yet. The calm before the tab."
              body={
                <>
                  Make one to start splitting, or{' '}
                  <Link to="/split" className="font-medium text-accent hover:underline">
                    split a bill
                  </Link>{' '}
                  without an account.
                </>
              }
            />
          ) : (
            <>
              {activeGroups.length > 0 ? (
                <ul className="space-y-2.5">{activeGroups.map((g) => groupRow(g))}</ul>
              ) : (
                <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
                  No active groups. Your archived ones are below.
                </p>
              )}
              {archivedGroups.length > 0 && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setShowArchived((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-ink"
                  >
                    <Icon name="archive" size={15} /> Archived ({archivedGroups.length})
                    <Icon
                      name="chevron-right"
                      size={15}
                      className={`transition ${showArchived ? 'rotate-90' : ''}`}
                    />
                  </button>
                  {showArchived && (
                    <ul className="mt-2.5 space-y-2.5">{archivedGroups.map((g) => groupRow(g, false))}</ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {selectMode && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onBulkArchive()}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-4 py-2 text-sm font-medium transition hover:border-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="archive" size={15} /> Archive
              </button>
              <button
                type="button"
                onClick={() => void onBulkDelete()}
                disabled={!allOwned || bulkBusy}
                title={allOwned ? undefined : 'You can only delete groups you own'}
                className="inline-flex items-center gap-1.5 rounded-full bg-neg-solid px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="trash" size={15} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
