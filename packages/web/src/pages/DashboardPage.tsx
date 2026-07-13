import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Money } from '@owewell/shared';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { MoneyText } from '../components/MoneyText';
import { SkeletonList } from '../components/Skeleton';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { groupsApi, type GroupSummary } from '../lib/groups';
import { clearPendingSplit, loadPendingSplit, quickSplitApi } from '../lib/quicksplit';

function perGroupLabel(netCents: number): { text: string; className: string } {
  if (netCents === 0) return { text: 'settled', className: 'text-muted' };
  const amount = Money.fromCents(Math.abs(netCents)).format();
  return netCents > 0
    ? { text: `+${amount}`, className: 'text-pos' }
    : { text: `-${amount}`, className: 'text-neg' };
}

export function DashboardPage(): ReactNode {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  // Distinguish a failed load from a genuinely empty account: null = loading, [] = empty,
  // loadError = the fetch failed (show a retry, not the cheerful "no groups" state).
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState('');
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(() => loadPendingSplit());
  const [savingPending, setSavingPending] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelected = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelect = (): void => {
    setSelectMode(false);
    setSelected(new Set());
  };

  async function onBulkArchive(): Promise<void> {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map((id) => groupsApi.setArchived(id, true)));
      setGroups((prev) => (prev ?? []).map((g) => (selected.has(g.id) ? { ...g, archived: true } : g)));
      toast.success(`Archived ${ids.length} ${ids.length === 1 ? 'group' : 'groups'}.`);
    } catch {
      toast.error('Could not archive some of those.');
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
    if (!ok) return;
    try {
      await Promise.all(ids.map((id) => groupsApi.remove(id)));
      setGroups((prev) => (prev ?? []).filter((g) => !selected.has(g.id)));
      toast.success(`Deleted ${ids.length} ${ids.length === 1 ? 'group' : 'groups'}.`);
    } catch {
      toast.error('Could not delete some of those.');
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

  // Archived groups drop out of the overall totals and the main list.
  const totals = useMemo(() => {
    const list = (groups ?? []).filter((g) => !g.archived);
    const owed = list.filter((g) => g.netCents > 0).reduce((s, g) => s + g.netCents, 0);
    const owe = list.filter((g) => g.netCents < 0).reduce((s, g) => s - g.netCents, 0);
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
    if (!name.trim()) return;
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
          isOwner: true,
        },
        ...(prev ?? []),
      ]);
      setName('');
      setCreatingOpen(false);
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
  const selectedGroups = (groups ?? []).filter((g) => selected.has(g.id));
  const allOwned = selectedGroups.length > 0 && selectedGroups.every((g) => g.isOwner);

  // `selectable` rows become tap-to-select in select mode; archived rows stay plain links.
  const groupRow = (group: GroupSummary, selectable = true): ReactNode => {
    const label = perGroupLabel(group.netCents);
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
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{group.name}</span>
          <span className="block text-sm text-muted">
            <span className="whitespace-nowrap">
              {group.memberCount} {group.memberCount === 1 ? 'person' : 'people'}
              {group.totalUnsettledCents > 0 && ' ·'}
            </span>
            {group.totalUnsettledCents > 0 && (
              <span className="whitespace-nowrap text-faint">
                {' '}
                {Money.fromCents(group.totalUnsettledCents).format()} unsettled
              </span>
            )}
          </span>
        </span>
        <span className={`tnum text-sm font-semibold ${label.className}`}>{label.text}</span>
        {!selecting && <Icon name="chevron-right" size={18} className="text-faint" />}
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
      <main className={`mx-auto max-w-2xl animate-rise px-4 py-8 ${selectMode ? 'pb-28' : ''}`}>
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
                {savingPending ? 'Saving...' : 'Save it'}
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

        <section className="glass rounded-3xl p-6 sm:p-7">
          <p className="text-sm font-medium text-muted">
            {settled ? 'Across all your groups' : owed ? "You're owed, overall" : 'You owe, overall'}
          </p>
          <p
            className={`mt-1 font-display text-5xl font-extrabold tracking-tight sm:text-6xl ${
              settled ? 'text-ink' : owed ? 'text-gradient' : 'text-neg'
            }`}
          >
            {settled && (groups?.length ?? 0) > 0 ? (
              'All settled'
            ) : (
              <MoneyText cents={Math.abs(totals.net)} />
            )}
          </p>
          {(totals.owed > 0 || totals.owe > 0) && (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas/40 px-3 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-pos" />
                <span className="text-muted">owed to you</span>
                <span className="tnum font-medium text-pos">
                  {Money.fromCents(totals.owed).format()}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas/40 px-3 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-neg" />
                <span className="text-muted">you owe</span>
                <span className="tnum font-medium text-neg">
                  {Money.fromCents(totals.owe).format()}
                </span>
              </span>
            </div>
          )}
        </section>

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
                    onClick={() => setSelectMode(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-3.5 py-1.5 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
                  >
                    <Icon name="check" size={16} /> Select
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCreatingOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-3.5 py-1.5 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
                >
                  <Icon name="plus" size={16} /> New
                </button>
              </>
            )}
          </div>
        </div>

        {creatingOpen && (
          <form onSubmit={(e) => void onCreate(e)} className="mt-3 flex gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tahoe trip, apartment 4B, book club..."
              className="flex-1 rounded-xl border border-line bg-field px-3.5 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <button
              type="submit"
              disabled={creating}
              className="btn-gradient rounded-full px-5 py-2.5 font-semibold transition active:scale-[0.98] disabled:opacity-60"
            >
              {creating ? 'Adding...' : 'Create'}
            </button>
          </form>
        )}
        {error && <p className="mt-2 text-sm font-medium text-neg">{error}</p>}

        <div className="mt-4">
          {loadError ? (
            <div className="rounded-3xl border border-dashed border-line p-10 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-muted">
                <Icon name="users" size={22} />
              </div>
              <p className="mt-4 text-lg font-medium">Couldn&apos;t load your groups.</p>
              <p className="mt-1 text-sm text-muted">Probably a hiccup on our end, not you.</p>
              <Button variant="secondary" onClick={loadGroups} className="mt-4">
                Try again
              </Button>
            </div>
          ) : groups === null ? (
            <SkeletonList rows={3} />
          ) : activeGroups.length === 0 && archivedGroups.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-line p-10 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-muted">
                <Icon name="users" size={22} />
              </div>
              <p className="mt-4 text-lg font-medium">No groups yet. The calm before the tab.</p>
              <p className="mt-1 text-sm text-muted">
                Make one to start splitting, or{' '}
                <Link to="/split" className="font-medium text-accent hover:underline">
                  do a quick split
                </Link>{' '}
                without an account.
              </p>
            </div>
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
            <span className="text-sm font-medium">
              {selected.size} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onBulkArchive()}
                className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-4 py-2 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
              >
                <Icon name="archive" size={15} /> Archive
              </button>
              <button
                type="button"
                onClick={() => void onBulkDelete()}
                disabled={!allOwned}
                title={allOwned ? undefined : 'You can only delete groups you own'}
                className="inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
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
