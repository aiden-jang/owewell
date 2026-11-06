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
import { useBulkGroupActions } from './useBulkGroupActions';
import { useToast } from '../components/Toast';
import { groupsApi, type GroupSummary } from '../lib/groups';
import { clearQuickSplitDraft } from '../lib/quickSplitDraft';
import { clearPendingSplit, loadPendingSplit, quickSplitApi } from '../lib/quicksplit';
import { queued } from '../lib/outbox';
import { useOutboxSync } from '../lib/useOutboxSync';

export function DashboardPage(): ReactNode {
  const navigate = useNavigate();
  const toast = useToast();
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [waiting, setWaiting] = useState(() => queued().length);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(() => loadPendingSplit());
  const [savingPending, setSavingPending] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
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

  const { bulkBusy, onBulkArchive, onBulkDelete } = useBulkGroupActions(selected, setGroups, exitSelect);

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

  useOutboxSync({
    onChanged: () => loadGroups(),
    onQueueChanged: () => setWaiting(queued().length),
  });

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
  const hasAnySpend = activeGroups.some((g) => g.totalSpentCents > 0);
  const othersStillOwe = activeGroups.some((g) => g.totalUnsettledCents > 0);
  const selectedGroups = (groups ?? []).filter((g) => selected.has(g.id));
  const allOwned = selectedGroups.length > 0 && selectedGroups.every((g) => g.isOwner);

  return (
    <div className="flex-1">
      <AppHeader />
      <main
        id="main"
        tabIndex={-1}
        className={`workspace-width mx-auto w-full animate-rise px-4 py-8 ${selectMode ? 'pb-28' : ''}`}
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

        <div className={activeGroups.length > 0 ? 'overview-grid' : undefined}>
          {activeGroups.length > 0 && (
            <DashboardBalance totals={totals} hasAnySpend={hasAnySpend} othersStillOwe={othersStillOwe} />
          )}

          <section aria-labelledby="your-groups" className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="your-groups" className="font-display text-xl font-semibold tracking-tight">
                Your groups
              </h2>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                      onClick={(event) => {
                        if (creatingOpen) {
                          closeCreate();
                          event.currentTarget.focus();
                        } else openCreate();
                      }}
                      onPointerDown={(event) => {
                        // Keep the name focused until Cancel closes it, rather than validating on pointer-down.
                        if (creatingOpen) event.preventDefault();
                      }}
                      aria-expanded={creatingOpen}
                      aria-controls={creatingOpen ? 'create-group-form' : undefined}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-3.5 py-1.5 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
                    >
                      <Icon name={creatingOpen ? 'x' : 'plus'} size={16} />
                      {creatingOpen ? 'Cancel' : 'New'}
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
                    <ul className="dashboard-groups surface">
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
                        aria-expanded={showArchived}
                        aria-controls={showArchived ? 'archived-groups' : undefined}
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
                        <ul id="archived-groups" className="dashboard-groups surface mt-2.5">
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
          </section>
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
