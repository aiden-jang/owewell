import type { ReactNode } from 'react';

// A small, friendly palette; each person gets a stable color from their name.
const COLORS = [
  '#f0573f',
  '#e0962f',
  '#3fa78a',
  '#5b8def',
  '#a86fd6',
  '#e06aa6',
  '#4bb3c4',
  '#cf6b3a',
];

function colorFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length] ?? '#f0573f';
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }): ReactNode {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const dims = size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm';
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${dims}`}
      style={{ backgroundColor: colorFor(name) }}
    >
      {initial}
    </span>
  );
}
