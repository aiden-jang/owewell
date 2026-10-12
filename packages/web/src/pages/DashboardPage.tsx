import { DashboardIntro } from '../components/SplitIntro';
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
import { DashboardBalance } from '../components/DashboardBalance';
import { SkeletonList } from '../components/Skeleton';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { groupsApi, type GroupSummary } from '../lib/groups';
import { clearQuickSplitDraft } from '../lib/quickSplitDraft';
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
      clearQuickSplitDraft();
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
    // Touch the field before returning, or Create on an empty name looks like the app froze.
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
    // Empty groups show their creation date; spending groups show the latest activity.
    const activity =
      group.totalSpentCents > 0 ? timeAgo(group.lastActivityAt) : `started ${timeAgo(group.createdAt)}`;
    const isSel = selected.has(group.id);
    const selecting = selectMode && selectable;
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
            <span className="truncate font-medium">{group.name}</span>
            <span className={`tnum shrink-0 text-right text-sm font-semibold ${label.className}`}>
              {group.netCents !== 0 && (
                <span className="block text-xs font-normal text-muted">
                  {group.netCents > 0 ? 'Owed to you' : 'You owe'}
                </span>
              )}
              {label.text}
            </span>
          </span>
          {/* xs and wrapping. At sm these three facts overflowed by 13px at 375px and clipped
              "$90.00 unsettled"; xs alone only moves the cliff. A name can be cut and still read as
              a cut name, but a list of facts with one severed mid-word says less than two facts. */}
          <span className="block text-xs text-muted">
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
    const cls = `row-interactive surface flex min-h-[92px] items-center gap-4 rounded-2xl p-4 hover:shadow-lg hover:shadow-black/20 ${
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
        className={`dashboard-page mx-auto w-full max-w-2xl animate-rise px-4 py-8 ${selectMode ? 'pb-28' : ''}`}
      >
        <DashboardIntro />
        {pending && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3">
            <span className="flex items-center gap-2 text-sm">
              <Icon name="sparkles" size={16} className="text-accent" />
              Your split is ready to save:{' '}
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
                {savingPending ? 'Saving…' : 'Save split'}
              </button>
              <button
                type="button"
                onClick={dismissPending}
                className="rounded-full border border-line px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink"
              >
                Not now
              </button>
            </div>
          </div>
        )}

        {waiting > 0 && (
          <p className="mb-4 flex items-center justify-center gap-2 rounded-full border border-dashed border-line-strong py-2 text-sm text-muted">
            <Icon name="share" size={14} />
            {waiting === 1
              ? 'One change is waiting for a connection'
              : `${waiting} changes are waiting for a connection`}
          </p>
        )}

        {activeGroups.length > 0 && (
          <DashboardBalance totals={totals} hasAnySpend={hasAnySpend} othersStillOwe={othersStillOwe} />
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
                aria-label="Group name"
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
        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-neg">
            {error}
          </p>
        )}

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
              action={
                !creatingOpen && (
                  <Button block={false} onClick={openCreate}>
                    Create your first group
                  </Button>
                )
              }
              body={
                <>
                  Make one to start splitting, or{' '}
                  <Link to="/split" className="font-medium text-accent hover:underline">
                    split a bill
                  </Link>{' '}
                  for a one-off expense.
                </>
              }
            />
          ) : (
            <>
              {activeGroups.length > 0 ? (
                <ul className="dashboard-groups space-y-2.5">{activeGroups.map((g) => groupRow(g))}</ul>
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
