import type { ReactNode } from 'react';

// Personal settlement is quieter than the whole group being settled.
export function SettledMark({ tone = 'settled' }: { tone?: 'settled' | 'square' }): ReactNode {
  const done = tone === 'settled';
  return (
    <span
      aria-hidden
      className={`animate-pop mx-auto grid h-14 w-14 place-items-center rounded-full border ${
        done ? 'border-pos/30 bg-pos/10 text-pos' : 'border-line-strong bg-surface2 text-muted'
      }`}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path className="animate-draw" d="M4 12.5 9.5 18 20 6.5" pathLength={1} />
      </svg>
    </span>
  );
}
