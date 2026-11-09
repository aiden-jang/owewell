import { DashboardIntro } from '../components/SplitIntro';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useDashboardMode } from './useDashboardMode.js';
import { useDashboardGroups } from './useDashboardGroups';
import { useSearchParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { CreateGroupForm } from '../components/CreateGroupForm';
import { Sheet } from '../components/Sheet';
import { PendingSplitCard } from '../components/PendingSplitCard';
import { BulkGroupBar } from '../components/BulkGroupBar';
import { OutboxNotice } from '../components/OutboxNotice';
import { DashboardGroupCard } from '../components/DashboardGroupCard';
import { DashboardBalance } from '../components/DashboardBalance';
import { SkeletonList } from '../components/Skeleton';
import { useBulkGroupActions } from './useBulkGroupActions';
import { useAuth } from '../auth/AuthContext';
import { groupsApi } from '../lib/groups';
import { usePendingSplits } from './usePendingSplits';
import { queued } from '../lib/outbox';
import { useOutboxSync } from '../lib/useOutboxSync';
import { useAsyncScope } from '../lib/useAsyncScope';
import {
  finishCreateAttempt,
  rememberCreateAttempt,
  type GroupCreateAttempt,
} from '../lib/groupCreateAttempt';
import { ApiError } from '../lib/api';

export function DashboardPage(): ReactNode {
  const { user } = useAuth();
  const ownerId = user?.id;
  const [params] = useSearchParams();
  const pending = usePendingSplits(ownerId, params.get('split'));
  const { captureScope } = useAsyncScope(ownerId);
  const { groups, loadError, loadGroups, applyGroupChange } = useDashboardGroups(ownerId);
  const [waiting, setWaiting] = useState(0);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const createAttempt = useRef<GroupCreateAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const { bulkBusy, onBulkArchive, onBulkDelete } = useBulkGroupActions(
    selected,
    applyGroupChange,
    exitSelect,
    ownerId,
  );

  const outboxSync = useOutboxSync({
    ownerId,
    onChanged: () => loadGroups(),
    onQueueChanged: () =>
      setWaiting(ownerId ? queued(undefined, ownerId).filter((entry) => !entry.failure).length : 0),
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

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (creatingRef.current) return;
    if (!name.trim()) {
      touchName();
      return;
    }
    creatingRef.current = true;
    const current = captureScope();
    setCreating(true);
    setError(null);
    try {
      const attempt = rememberCreateAttempt(name.trim(), ownerId, createAttempt.current);
      createAttempt.current = attempt;
      const group = await groupsApi.create(attempt.name, attempt.clientId, ownerId);
      finishCreateAttempt(attempt.clientId);
      createAttempt.current = null;
      if (!current()) return;
      applyGroupChange((prev) =>
        prev?.some(({ id }) => id === group.id)
          ? prev
          : [
              {
                id: group.id,
                name: group.name,
                createdAt: group.createdAt,
                archived: group.archived,
                memberCount: group.members.length,
                netCents: 0,
                totalUnsettledCents: 0,
                totalSpentCents: 0,
                lastActivityAt: group.createdAt,
                isOwner: true,
              },
              ...(prev ?? []),
            ],
      );
      closeCreate();
    } catch (err) {
      if (current())
        setError(
          err instanceof ApiError && err.status < 500
            ? err.message
            : 'Couldn’t confirm the group was created. Try again with the same name.',
        );
    } finally {
      creatingRef.current = false;
      if (current()) setCreating(false);
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
        {pending.missingResume && (
          <p className="mb-4 text-sm text-muted" role="status">
            That split is no longer waiting to save.
          </p>
        )}
        {pending.visible.map((record) => (
          <PendingSplitCard
            key={record.id}
            pending={record.split}
            busy={pending.savingId !== null}
            saving={pending.savingId === record.id}
            onSave={() => void pending.save(record)}
            onDismiss={() => pending.dismiss(record)}
          />
        ))}

        {(waiting > 0 ||
          outboxSync.unassigned > 0 ||
          outboxSync.failed.length > 0 ||
          outboxSync.undoableDeletions.length > 0) && (
          <div className="mb-4">
            <OutboxNotice
              count={waiting}
              waitingMessage={
                waiting === 1
                  ? 'One change is waiting for a connection'
                  : `${waiting} changes are waiting for a connection`
              }
              sync={outboxSync}
              groupName={(id) => groups?.find((group) => group.id === id)?.name}
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
              {loadError && groups === null ? (
                <EmptyState
                  tone="problem"
                  icon="users"
                  title="Couldn't load your groups."
                  body="Probably a hiccup on our end, not you."
                  action={
                    <Button variant="secondary" onClick={() => loadGroups()}>
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
                  body="Create a group to start keeping track of shared expenses."
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
        <BulkGroupBar
          count={selected.size}
          busy={bulkBusy}
          canDelete={allOwned}
          onArchive={onBulkArchive}
          onDelete={onBulkDelete}
        />
      )}
    </div>
  );
}
