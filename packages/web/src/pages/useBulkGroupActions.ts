import { useState, type Dispatch, type SetStateAction } from 'react';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { groupsApi, type GroupSummary } from '../lib/groups';

export function useBulkGroupActions(
  selected: ReadonlySet<string>,
  setGroups: Dispatch<SetStateAction<GroupSummary[] | null>>,
  exitSelect: () => void,
) {
  const confirm = useConfirm();
  const toast = useToast();
  const [bulkBusy, setBulkBusy] = useState(false);

  async function updateGroups(ids: string[], action: 'archive' | 'delete'): Promise<void> {
    if (bulkBusy) return;
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          if (action === 'archive') await groupsApi.setArchived(id, true);
          else await groupsApi.remove(id);
        }),
      );
      const updated = new Set(ids.filter((_, index) => results[index]?.status === 'fulfilled'));
      if (updated.size) {
        setGroups((prev) => {
          if (!prev) return prev;
          return action === 'archive'
            ? prev.map((group) => (updated.has(group.id) ? { ...group, archived: true } : group))
            : prev.filter((group) => !updated.has(group.id));
        });
      }
      const verb = action === 'archive' ? 'Archived' : 'Deleted';
      const changed = `${verb} ${updated.size} ${updated.size === 1 ? 'group' : 'groups'}.`;
      const failed = ids.length - updated.size;
      if (failed === 0) toast.success(changed);
      else if (updated.size === 0) toast.error(`Could not ${action} the selected groups.`);
      else toast.error(`${changed} Could not ${action} ${failed} ${failed === 1 ? 'group' : 'groups'}.`);
    } finally {
      setBulkBusy(false);
      exitSelect();
    }
  }

  async function onBulkArchive(): Promise<void> {
    if (selected.size > 0) await updateGroups([...selected], 'archive');
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
    if (ok) await updateGroups(ids, 'delete');
  }

  return { bulkBusy, onBulkArchive, onBulkDelete };
}
