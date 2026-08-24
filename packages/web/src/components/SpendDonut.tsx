import { type ReactNode } from 'react';
import { useMoney } from '../lib/currency';

/**
 * Part-to-whole view of spend by category: a dependency-free SVG donut plus a legend, both
 * tappable to filter the activity feed. Colour is categorical identity, one fixed hue per category
 * so a category keeps its colour across groups — but never the only carrier of it: every legend row
 * pairs the swatch with a label.
 *
 * The hues come from `--color-cat-*` rather than from literals in here. They used to be eight hexes
 * in this file, which meant the warm theme inherited colours picked against a dark canvas, the
 * contrast test could not see them, and the bar chart could not reach them — so the two views of the
 * same data were coloured differently. Referencing the variables means both read one source and the
 * theme swap applies to charts too.
 */
const hueOf = (key: string): string => `var(--p-cat-${key}, var(--p-faint))`;

interface Slice {
  meta: { key: string; label: string; emoji: string };
  cents: number;
}

export function SpendDonut({
  data,
  total,
  activeKey = null,
  onSelect,
}: {
  data: Slice[];
  total: number;
  /** Omit both to render read-only (e.g. the public share page has no feed to filter). */
  activeKey?: string | null;
  /** Called with null when the active slice is picked again, which is how you clear it from here. */
  onSelect?: (key: string | null) => void;
}): ReactNode {
  const fmt = useMoney();
  const interactive = typeof onSelect === 'function';
  const size = 168;
  const stroke = 24;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const gap = 2; // 2px surface gap between slices

  let acc = 0;
  const arcs = data.map((d) => {
    const frac = total > 0 ? d.cents / total : 0;
    const len = Math.max(0, frac * circ - gap);
    const arc = {
      ...d,
      color: hueOf(d.meta.key),
      len,
      offset: -acc * circ,
      pct: Math.round(frac * 100),
    };
    acc += frac;
    return arc;
  });

  return (
    <div className="mt-3 flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="img"
          aria-label="Spending by category"
        >
          {arcs.map((a) => {
            const active = activeKey === a.meta.key;
            const dim = activeKey !== null && !active;
            return (
              <circle
                key={a.meta.key}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={stroke}
                strokeDasharray={`${a.len} ${circ - a.len}`}
                strokeDashoffset={a.offset}
                onClick={interactive ? () => onSelect(active ? null : a.meta.key) : undefined}
                className={interactive ? 'cursor-pointer transition-opacity' : 'transition-opacity'}
                style={{ opacity: dim ? 0.25 : 1 }}
              >
                <title>{`${a.meta.label}: ${fmt(a.cents)} (${a.pct}%)`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-faint">total</span>
          <span className="tnum font-display text-lg font-semibold">{fmt(total)}</span>
        </div>
      </div>
      <ul className="w-full flex-1 space-y-1">
        {arcs.map((a) => {
          const active = activeKey === a.meta.key;
          const inner = (
            <>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} aria-hidden />
              <span className={`truncate ${active ? 'font-medium text-accent' : ''}`}>{a.meta.label}</span>
              <span className="tnum ml-auto shrink-0 text-faint">{a.pct}%</span>
              <span className="tnum w-20 shrink-0 text-right text-muted">{fmt(a.cents)}</span>
            </>
          );
          return (
            <li key={a.meta.key}>
              {interactive ? (
                <button
                  type="button"
                  onClick={() => onSelect(active ? null : a.meta.key)}
                  aria-pressed={active}
                  aria-label={`${active ? 'Clear filter' : 'Filter activity by'} ${a.meta.label}`}
                  className={`-mx-2 flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm transition hover:bg-surface2 ${active ? 'bg-accent-soft' : ''}`}
                >
                  {inner}
                </button>
              ) : (
                <div className="flex w-full items-center gap-2 px-0 py-1 text-sm">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
