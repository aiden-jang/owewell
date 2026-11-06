import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { useToast } from '../components/Toast';
import { groupsApi, type GroupSummary } from '../lib/groups';
import { useAsyncScope } from '../lib/useAsyncScope';

export function useDashboardGroups(ownerId?: string) {
  const toast = useToast();
  const { begin, invalidate } = useAsyncScope(ownerId);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const applyGroupChange = useCallback(
    (update: SetStateAction<GroupSummary[] | null>) => {
      invalidate();
      setGroups(update);
    },
    [invalidate],
  );
  const loadGroups = useCallback(() => {
    const current = begin();
    setLoadError(false);
    groupsApi
      .list()
      .then((loaded) => {
        if (current()) setGroups(loaded);
      })
      .catch(() => {
        if (!current()) return;
        setLoadError(true);
        toast.error('Could not load your groups.');
      });
  }, [begin, toast]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  return { groups, loadError, loadGroups, applyGroupChange };
}
