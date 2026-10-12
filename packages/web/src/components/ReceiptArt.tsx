import type { ReactNode } from 'react';

export function ReceiptArt(): ReactNode {
  return (
    <svg className="receipt-art" viewBox="0 0 360 260" fill="none" aria-hidden="true">
      <circle cx="184" cy="130" r="104" fill="var(--color-accent-soft)" />
      <g transform="rotate(10 221 128)">
        <rect x="173" y="55" width="112" height="150" rx="16" fill="#98cec9" />
        <path d="M193 88h68m-68 17h48m-48 59h68" stroke="#215c60" strokeWidth="3" strokeLinecap="round" />
        <circle cx="229" cy="135" r="12" stroke="#215c60" strokeWidth="3" />
      </g>
      <g transform="rotate(-9 141 132)">
        <path
          d="M91 37h112v183l-14-8-14 8-14-8-14 8-14-8-14 8-14-8-14 8V37Z"
          fill="#fffdf8"
          stroke="#215c60"
          strokeWidth="2"
        />
        <path d="M110 66h72M110 168h72M110 185h40" stroke="#98cec9" strokeWidth="3" strokeLinecap="round" />
        <path d="M125 113h7m27 0h7m-23 13h6" stroke="#215c60" strokeWidth="4" strokeLinecap="round" />
        <path d="M110 82h42" stroke="#98cec9" strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="285" cy="192" r="23" fill="#215c60" />
      <path
        d="m274 192 7 7 14-15"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M59 103h14m-7-7v14M293 48h12m-6-6v12"
        stroke="var(--color-muted)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
