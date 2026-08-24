import type { ReactNode } from 'react';

/*
 * The first thing in the tab order, and invisible until it is reached.
 *
 * Every page here opens with a sticky header, so without this a keyboard user tabs through the
 * brand link, the account link and the logout button before reaching anything on the page — on
 * every single navigation. A group page is four tab stops of chrome away from its own content.
 *
 * `sr-only` until focused rather than hidden: a skip link that is `display: none` is not in the tab
 * order at all, which is the most common way this is shipped broken. It becomes a real, visible
 * button the moment it takes focus, because a sighted keyboard user needs to see where they are.
 *
 * The target carries tabIndex={-1} so following the fragment actually moves focus. Browsers scroll
 * to a fragment whether or not its target can hold focus, and without it the next Tab press
 * continues from the skip link — back into the header it just skipped.
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
