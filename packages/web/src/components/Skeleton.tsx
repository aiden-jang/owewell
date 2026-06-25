import type { ReactNode } from 'react';

/** A shimmering placeholder block for loading states. */
export function Skeleton({ className = '' }: { className?: string }): ReactNode {
  return <div className={`animate-pulse rounded-xl bg-line/60 ${className}`} aria-hidden />;
}

/** A few stacked card-shaped skeletons, for list loading states. */
export function SkeletonList({ rows = 3 }: { rows?: number }): ReactNode {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
