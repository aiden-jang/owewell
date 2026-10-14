import { DashboardIntro } from '../components/SplitIntro';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useDashboardMode } from './useDashboardMode.js';
import { Link, useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { CreateGroupForm } from '../components/CreateGroupForm';
import { PendingSplitCard } from '../components/PendingSplitCard';
import { DashboardGroupCard } from '../components/DashboardGroupCard';
import { DashboardBalance } from '../components/DashboardBalance';
import { SkeletonList } from '../components/Skeleton';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { groupsApi, type GroupSummary } from '../lib/groups';
import { clearQuickSplitDraft } from '../lib/quickSplitDraft';
import { clearPendingSplit, loadPendingSplit, quickSplitApi } from '../lib/quicksplit';
import { queued } from '../lib/outbox';
import { useOutboxSync } from '../lib/useOutboxSync';

export function DashboardPage(): ReactNode {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [waiting, setWaiting] = useState(() => queued().length);
  // Distinguish a failed load from a genuinely empty account: null = loading, [] = empty,
  // loadError = the fetch failed (show a retry, not the cheerful "no groups" state).
  const [loadError, setLoadError] = useState(false);
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
          <PendingSplitCard
            pending={pending}
            busy={savingPending}
            onSave={() => void savePending()}
            onDismiss={dismissPending}
          />
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
          <CreateGroupForm
            name={name}
            nameTouched={nameTouched}
            busy={creating}
            onNameChange={setName}
            onTouch={touchName}
            onClose={closeCreate}
            onSubmit={(event) => void onCreate(event)}
          />
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
                <ul className="dashboard-groups space-y-2.5">
                  {activeGroups.map((group) => (
                    <DashboardGroupCard
                      key={group.id}
                      group={group}
                      selectMode={selectMode}
                      selected={selected.has(group.id)}
                      onToggle={toggleSelected}
                    />
                  ))}
                </ul>
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
                    <ul className="mt-2.5 space-y-2.5">
                      {archivedGroups.map((group) => (
                        <DashboardGroupCard
                          key={group.id}
                          group={group}
                          selectMode={false}
                          selected={false}
                          onToggle={toggleSelected}
                        />
                      ))}
                    </ul>
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
