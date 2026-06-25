import type { ReactNode } from 'react';

/** The gradient app mark: a rounded square holding a minimal receipt glyph. */
export function BrandMark({ size = 26 }: { size?: number }): ReactNode {
  const r = size * 0.3;
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center"
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: 'linear-gradient(135deg, #a78bfa, #22d3ee)',
        boxShadow: '0 4px 14px -4px rgba(124,92,255,0.6)',
      }}
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M6 3.5h12v17l-2.2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 20.5v-17Z"
          fill="#0a0a12"
          fillOpacity="0.92"
        />
        <path d="M9 8.5h6M9 12h6M9 15.5h3.5" stroke="#a78bfa" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}
