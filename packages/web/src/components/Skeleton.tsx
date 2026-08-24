import type { ReactNode } from 'react';

/*
 * Placeholders, shaped like the thing they stand in for.
 *
 * A skeleton only earns its place if the layout does not move when the content lands, so these come
 * in the two shapes this app actually uses: separate cards, like the dashboard's group rows, and one
 * hairline-divided panel, like the activity feed. Measured against the real pages at 375px.
 */

/** A shimmering placeholder block for loading states. */
export function Skeleton({ className = '' }: { className?: string }): ReactNode {
  return <div className={`animate-pulse rounded-xl bg-line/60 ${className}`} aria-hidden />;
}

/** Separate cards with gaps between them — the dashboard's list of groups. */
export function SkeletonList({ rows = 3 }: { rows?: number }): ReactNode {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-[72px] w-full rounded-2xl" />
      ))}
    </div>
  );
}

/**
 * One panel, hairline rows — the activity feed.
 *
 * Drawn as an avatar and two lines rather than a grey slab, because the row it replaces is an avatar
 * and two lines: a solid block of the right height still lands as a different picture.
 */
export function SkeletonPanel({ rows = 3 }: { rows?: number }): ReactNode {
  return (
    <div className="panel" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
          {/* h-5 over h-4: a feed row is a 24px title over a 20px detail line, and rows that are
              10px short across three of them is a visible shove when the real list lands. */}
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
          <Skeleton className="h-4 w-14 shrink-0" />
        </div>
      ))}
    </div>
  );
}
