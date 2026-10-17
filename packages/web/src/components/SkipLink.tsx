import type { ReactNode } from 'react';

// The destination needs tabIndex=-1 so skipping chrome moves keyboard focus as well as scrolling.
export function SkipLink(): ReactNode {
  return (
    <a
      href="#main"
      className="sr-only rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
    >
      Skip to content
    </a>
  );
}
