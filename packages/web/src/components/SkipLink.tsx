import type { ReactNode } from 'react';

/*
 * The first thing in the tab order, invisible until reached. Every page opens with a sticky header,
 * so without it a keyboard user tabs through four stops of chrome on every navigation.
 *
 * `sr-only` until focused, not `display: none` — hidden takes it out of the tab order entirely,
 * which is the usual way this ships broken.
 *
 * The target needs tabIndex={-1} or following the fragment scrolls without moving focus, and the
 * next Tab continues from the skip link, back into the header it just skipped.
 */
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
