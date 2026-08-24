import { type ReactNode } from 'react';
import { categoryMeta } from '@owewell/core';

/*
 * A category, shown two ways, and the rule for which.
 *
 * These were all emoji once. Then they were all dots, which fixed the charts and broke the picker:
 * choosing a category is a recognition task, and 🏨 is far faster to find in a grid of eight than a
 * 2px disc with a word beside it. Neither answer is right everywhere, because the two places are
 * doing different jobs.
 *
 *   CategoryGlyph  where a category is a THING you recognise — the picker, a feed row, an expense.
 *   CategoryDot    where a category is a VALUE being encoded — bars, slices, legends.
 *
 * In a chart the colour carries the data, so a glyph beside it is decoration competing with the
 * thing it sits next to; the donut legend used to print the emoji directly beside the swatch that
 * already said the same thing. In a list nothing else identifies the category, so the glyph is the
 * identity and a dot is a colour nobody has a key for.
 */

/** Where a category is a thing you recognise. Decorative: the label is always beside it. */
export function CategoryGlyph({ categoryKey }: { categoryKey: string }): ReactNode {
  return (
    <span aria-hidden className="shrink-0">
      {categoryMeta(categoryKey).emoji}
    </span>
  );
}

/** Where a category is a value being encoded. Same hue the charts give it, so they agree. */
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
