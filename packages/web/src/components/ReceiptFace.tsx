import type { ReactNode } from 'react';

export function ReceiptFace({ className = '' }: { className?: string }): ReactNode {
  return (
    <svg className={`receipt-face ${className}`} viewBox="0 0 64 76" fill="none" aria-hidden="true">
      <path
        d="M9 5h46v63l-6-4-6 4-6-4-6 4-6-4-6 4-5-4-5 4V5Z"
        fill="#fffdf8"
        stroke="#66509c"
        strokeWidth="2"
      />
      <path d="M19 17h26m-26 7h17" stroke="#c7b5f3" strokeWidth="2" strokeLinecap="round" />
      <g className="receipt-eyes" stroke="#66509c" strokeWidth="3" strokeLinecap="round">
        <path d="M20 38h5m14 0h5" />
      </g>
      <path d="M30 46h4" stroke="#66509c" strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="m27 56 3 3 7-7"
        stroke="#66509c"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
