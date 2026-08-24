import { useEffect, useState, type ReactNode } from 'react';
import { currentTheme, onThemeChange, setTheme } from '../lib/theme';

/*
 * Two palettes ship. This is how a person picks one.
 *
 * Until now the only switch was `owewell.theme('warm')` in a browser console, which is a switch for
 * whoever wrote it and nobody else. Both palettes are complete and contrast-tested; one of them was
 * simply unreachable.
 *
 * Not a sun/moon icon, and not in the header. A sun/moon is the reflex answer and it is wrong twice
 * here: these are named "warm" and "dark" rather than light and dark, and the header already holds
 * the account and the way out. The footer is where a preference that gets set once and then left
 * alone belongs, next to the other things you visit deliberately and rarely.
 *
 * Subscribed rather than local state, so the console handles and this stay in agreement.
 */
export function ThemeSwitch(): ReactNode {
  const [theme, setLocal] = useState(currentTheme);
  useEffect(() => onThemeChange(setLocal), []);

  return (
    <span className="inline-flex overflow-hidden rounded-full border border-line" role="group" aria-label="Palette">
      {(['warm', 'dark'] as const).map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => setTheme(name)}
          aria-pressed={theme === name}
          className={`px-2.5 py-0.5 capitalize transition ${
            theme === name ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:text-ink'
          }`}
        >
          {name}
        </button>
      ))}
    </span>
  );
}
