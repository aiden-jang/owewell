import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from './AppHeader';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';
import { Skeleton, SkeletonPanel } from './Skeleton';

export function GroupShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex-1">
      <AppHeader />
      <main
        id="main"
        tabIndex={-1}
        className="workspace-width mx-auto flex w-full animate-rise flex-col gap-5 px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-8"
      >
        {children}
      </main>
    </div>
  );
}

export function GroupLoadingState({
  loadFailed,
  notFound,
  onRetry,
}: {
  loadFailed: boolean;
  notFound: boolean;
  onRetry: () => void;
}): ReactNode {
  if (loadFailed) {
    return (
      <GroupShell>
        <EmptyState
          titleAs="h1"
          tone="problem"
          icon="wallet"
          title="Couldn't load this group."
          body="Probably a hiccup on our end, not you."
          action={
            <button
              type="button"
              onClick={() => onRetry()}
              className="btn-gradient inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
            >
              Try again
            </button>
          }
        />
      </GroupShell>
    );
  }

  if (notFound) {
    return (
      <GroupShell>
        <EmptyState
          titleAs="h1"
          tone="problem"
          icon="users"
          title="That group went missing. Or was never yours."
          body="It may have been deleted, or you're not a member."
          action={
            <Link
              to="/"
              className="btn-gradient inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
            >
              <Icon name="arrow-left" size={15} /> Back to your groups
            </Link>
          }
        />
      </GroupShell>
    );
  }

  return (
    <GroupShell>
      <div aria-busy="true" aria-label="Opening group" className="grid gap-5">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-[76px] w-full rounded-2xl" />
        <div className="ledger-grid">
          <div className="ledger-summary">
            <Skeleton className="h-56 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </div>
          <div>
            <Skeleton className="mb-3 h-6 w-24" />
            <SkeletonPanel rows={3} />
          </div>
        </div>
      </div>
    </GroupShell>
  );
}
