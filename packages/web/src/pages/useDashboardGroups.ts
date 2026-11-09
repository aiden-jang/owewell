import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { useToast } from '../components/Toast';
import { groupsApi, type GroupSummary } from '../lib/groups';
import { useAsyncScope } from '../lib/useAsyncScope';

export function useDashboardGroups(ownerId?: string) {
  const toast = useToast();
  const { begin, invalidate } = useAsyncScope(ownerId);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const loadedOnce = useRef(false);
  const applyGroupChange = useCallback(
    (update: SetStateAction<GroupSummary[] | null>) => {
      invalidate();
      setGroups(update);
    },
    [invalidate],
  );
  const loadGroups = useCallback(
    (background = false) => {
      const current = begin();
      if (!background) setLoadError(false);
      groupsApi
        .list(ownerId)
        .then((loaded) => {
          if (current()) {
            loadedOnce.current = true;
            setGroups(loaded);
            setLoadError(false);
          }
        })
        .catch(() => {
          if (!current() || background) return;
          setLoadError(true);
          toast.error('Could not load your groups.');
        });
    },
    [begin, ownerId, toast],
  );

  useEffect(() => {
    loadGroups();
    let timer: number | undefined;
    const refresh = () => {
      if (!loadedOnce.current || !navigator.onLine || document.visibilityState !== 'visible') return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => loadGroups(true), 0);
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadGroups]);

  return { groups, loadError, loadGroups, applyGroupChange };
}
