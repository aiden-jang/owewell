import { DashboardIntro } from '../components/SplitIntro';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useDashboardMode } from './useDashboardMode.js';
import { Link, useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { CreateGroupForm } from '../components/CreateGroupForm';
import { Sheet } from '../components/Sheet';
import { PendingSplitCard } from '../components/PendingSplitCard';
import { OutboxNotice } from '../components/OutboxNotice';
import { DashboardGroupCard } from '../components/DashboardGroupCard';
import { DashboardBalance } from '../components/DashboardBalance';
import { SkeletonList } from '../components/Skeleton';
import { useBulkGroupActions } from './useBulkGroupActions';
import { useToast } from '../components/Toast';
import { groupsApi, type GroupSummary } from '../lib/groups';
import { clearQuickSplitDraft, readQuickSplitDraft } from '../lib/quickSplitDraft';
import { clearPendingSplit, loadPendingSplit, quickSplitApi } from '../lib/quicksplit';
import { queued } from '../lib/outbox';
import { useOutboxSync } from '../lib/useOutboxSync';
import { useAsyncScope } from '../lib/useAsyncScope';

export function DashboardPage(): ReactNode {
  const navigate = useNavigate();
  const toast = useToast();
  const { captureScope } = useAsyncScope();
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

  const outboxSync = useOutboxSync({
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
    if (!pending || savingPending) return;
    const samePage = captureScope();
    const startUrl = window.location.href;
    const current = () => samePage() && window.location.href === startUrl;
    const savedAt = readQuickSplitDraft()?.savedAt;
    setSavingPending(true);
    try {
      const { groupId } = await quickSplitApi.save(pending);
      if (JSON.stringify(loadPendingSplit()) === JSON.stringify(pending)) {
        clearPendingSplit();
        if (readQuickSplitDraft()?.savedAt === savedAt) clearQuickSplitDraft();
      }
      if (current()) {
        setPending(null);
        navigate(`/groups/${groupId}`);
      }
    } catch {
      if (!current()) return;
      setSavingPending(false);
      toast.error('Could not save that split. Give it another go.');
    }
  }

  function dismissPending(): void {
    if (savingPending) return;
    clearPendingSplit();
    setPending(null);
  }

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (creating) return;
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
          <div className="mb-4">
            <OutboxNotice
              count={waiting}
              waitingMessage={
                waiting === 1
                  ? 'One change is waiting for a connection'
                  : `${waiting} changes are waiting for a connection`
              }
              sync={outboxSync}
            />
          </div>
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
                    disabled={bulkBusy}
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
                    {groups && groups.length > 0 && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.focus({ preventScroll: true });
                          openCreate();
                        }}
                        aria-haspopup="dialog"
                        data-focus-return="create-group"
                        className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-3.5 py-1.5 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
                      >
                        <Icon name="plus" size={16} /> New
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

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
                    <Button
                      block={false}
                      aria-haspopup="dialog"
                      data-focus-return="create-group"
                      onClick={(event) => {
                        event.currentTarget.focus({ preventScroll: true });
                        openCreate();
                      }}
                    >
                      Create your first group
                    </Button>
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
                          selectionDisabled={bulkBusy}
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
                  {!selectMode && (
                    <p className="mt-4 text-sm text-muted">
                      For a one-off expense,{' '}
                      <Link to="/split" className="font-medium text-accent underline underline-offset-4">
                        split a bill
                      </Link>
                      .
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </main>

      <Sheet
        open={creatingOpen}
        onClose={closeCreate}
        title="New group"
        autoFocusField
        closeDisabled={creating}
      >
        <CreateGroupForm
          name={name}
          nameTouched={nameTouched}
          busy={creating}
          error={error}
          onNameChange={setName}
          onTouch={touchName}
          onSubmit={(event) => void onCreate(event)}
        />
      </Sheet>

      {selectMode && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <span role="status" className="text-sm font-medium">
              {bulkBusy ? 'Updating groups…' : `${selected.size} selected`}
            </span>
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
