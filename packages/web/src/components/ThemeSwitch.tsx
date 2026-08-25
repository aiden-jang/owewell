import { useEffect, useState, type ReactNode } from 'react';
import { currentTheme, onThemeChange, setTheme } from '../lib/theme';

/*
 * Two palettes ship. This is how a person picks one.
 *
 * Not a sun/moon icon, and not in the header: these are named "warm" and "dark" rather than light
 * and dark, and the header already holds the account and the way out. A preference set once and
 * then left alone belongs in the footer.
 *
 * Subscribed rather than local state, so the console handles and this stay in agreement.
 */
export function ThemeSwitch(): ReactNode {
  const [theme, setLocal] = useState(currentTheme);
  useEffect(() => onThemeChange(setLocal), []);

  return (
    /* p-0.5 with rounded children, matching the bars/donut toggle. The previous shape —
       overflow-hidden on a rounded-full wrapper — clipped each button's corners, which cut the
       tappable height at the centre column to 23px even after the button itself grew to 32. */
    <span className="inline-flex rounded-full border border-line p-0.5" role="group" aria-label="Palette">
      {(['warm', 'dark'] as const).map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => setTheme(name)}
          aria-pressed={theme === name}
          className={`tap rounded-full px-2.5 py-1.5 capitalize transition ${
            theme === name ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:text-ink'
          }`}
        >
          {name}
        </button>
      ))}
    </span>
  );
}
