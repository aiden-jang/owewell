import type { ReactNode } from 'react';

/**
 * The app mark: a rounded square holding a receipt glyph.
 *
 * Every colour comes from the theme, so it follows the palette instead of staying violet-to-cyan
 * forever. It used to be a hardcoded gradient with a purple glow, which meant the logo announced the
 * old design language even after the rest of the app had moved on.
 *
 * `currentColor` on the glyph is deliberate: the mark inherits whatever ink surrounds it, so it works
 * on the accent tile, on a surface, and inside a button without a variant for each.
 */
export function BrandMark({ size = 26 }: { size?: number }): ReactNode {
  const r = size * 0.3;
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center bg-accent text-[color:var(--color-accent-ink)]"
      style={{ width: size, height: size, borderRadius: r }}
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M6 3.5h12v17l-2.2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 20.5v-17Z"
          fill="currentColor"
          fillOpacity="0.95"
        />
        <path
          d="M9 8.5h6M9 12h6M9 15.5h3.5"
          stroke="var(--color-accent)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
