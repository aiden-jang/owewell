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
      {/*
       * One gap between blocks, owned here rather than by each block's own top margin — otherwise
       * the distance between two peers is decided by whichever was written second.
       *
       * Anything needing a different distance from its neighbour belongs inside that neighbour.
       */}
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-2xl animate-rise flex-col gap-5 px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-8"
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
      {/* The same blocks the loaded page has, at the heights it has them — a placeholder that is
            shorter or in a different order makes everything jump on arrival, which is the one job a
            skeleton has. Spacing comes from the Shell's gap-5; no margins here. */}
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-3 h-9 w-40" />
      {/* Card-shaped, not slab-shaped: matched heights alone give two 300px rectangles of flat
            grey, which reads as a broken page rather than an arriving one. */}
      <div className="surface flex h-[338px] flex-col items-center rounded-3xl p-6">
        <Skeleton className="h-9 w-32 rounded-full" />
        <Skeleton className="mt-5 h-4 w-28" />
        <Skeleton className="mt-3 h-12 w-48" />
        <Skeleton className="mt-6 h-1.5 w-full max-w-xs rounded-full" />
        <Skeleton className="mt-6 h-5 w-36" />
      </div>
      <div className="h-[310px] rounded-2xl border border-line bg-card p-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-3 h-4 w-2/3" />
        <Skeleton className="mt-4 h-9 w-full rounded-xl" />
        <Skeleton className="mt-4 h-[76px] w-full rounded-xl" />
        <Skeleton className="mt-2 h-[76px] w-full rounded-xl" />
      </div>
      {/* The fronting insight and the filter bar. Both are conditional on the loaded page, so this
            is a bet — and the right way to bet, because a skeleton that comes up short shoves the
            page down while somebody is already reading it. */}
      <Skeleton className="h-[66px] w-full rounded-2xl" />
      <Skeleton className="h-[35px] w-full rounded-full" />
      <div>
        <Skeleton className="ml-auto h-5 w-40" />
        <div className="mt-3">
          <SkeletonPanel rows={3} />
        </div>
      </div>
    </GroupShell>
  );
}
