import { useState, type ReactNode } from 'react';
import { isMuted, toggleMuted } from '../lib/sound';

/*
 * Sound is on by default, which is only defensible because a browser won't start an audio context
 * outside a user gesture: the first noise this app can make is a response to your own tap. The
 * control still sits in the header rather than a settings screen, because owewell gets opened at a
 * table with other people and "make it stop" has to be one tap away from wherever you are.
 */
export function SoundToggle(): ReactNode {
  const [muted, setMuted] = useState(isMuted);

  return (
    <button
      type="button"
      onClick={() => setMuted(toggleMuted())}
      aria-pressed={muted}
      aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
      className="grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-surface2 hover:text-ink"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        {muted ? (
          <>
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </>
        ) : (
          <>
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M19 5a10 10 0 0 1 0 14" />
          </>
        )}
      </svg>
    </button>
  );
}
