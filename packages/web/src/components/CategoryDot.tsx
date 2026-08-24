import { type ReactNode } from 'react';

/*
 * A category's identity, as a dot.
 *
 * This was a full-colour emoji — 🏨🍽️🛒🚗 — which renders differently on every platform, sits
 * awkwardly in an otherwise restrained palette, and in the donut legend duplicated the swatch
 * sitting right next to it. The dot uses the same hue the charts give that category, so a category
 * looks the same in a feed row, a bar and a slice.
 *
 * Emoji still go into text that leaves the app — a share message lands in someone's chat, where a
 * CSS variable is no use. See `WrappedRecap`.
 */
export function CategoryDot({ categoryKey, label }: { categoryKey: string; label?: string }): ReactNode {
  return (
    <span
      // Decorative: every place this appears, the category is also named in text beside it.
      aria-hidden
      title={label}
      className="inline-block h-2 w-2 shrink-0 rounded-full align-middle"
      style={{ background: `var(--p-cat-${categoryKey}, var(--p-faint))` }}
    />
  );
}
