import type { ThemeName } from './contrast.js';

/**
 * Which palette is on.
 *
 * Exists so the direction can be decided by looking at real groups and real numbers rather than at a
 * mock with a group called "Tahoe trip". Everything is CSS variables, so switching is one attribute and
 * costs nothing — the palette is the cheap decision and this keeps it cheap.
 *
 * Set it from the console:  owewell.theme('warm')
 */

const KEY = 'owewell:theme';
const DEFAULT_THEME: ThemeName = 'warm';

function applyTheme(name: ThemeName): void {
  document.documentElement.dataset.theme = name;
  // The address-bar / status-bar colour has to follow, or a light theme gets a black notch on iOS.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      'content',
      getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim() || '#0b0b0d',
    );
  }
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // Private mode, or storage disabled. The theme still applies for this session.
  }
}

function storedTheme(): ThemeName {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'dark' || v === 'warm') return v;
  } catch {
    // ignore
  }
  return DEFAULT_THEME;
}

/** Forget the local override and fall back to whatever the app ships as its default. */
function clearTheme(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  applyTheme(DEFAULT_THEME);
}

/**
 * Call once at boot, before the app paints, so there is no flash of the wrong palette.
 *
 * Hangs the switcher on `window.owewell` rather than building a settings screen for a decision that
 * gets made once and then deleted.
 *
 *   owewell.theme('warm')   try the warm palette on this device
 *   owewell.reset()         drop the local override and use the shipped default
 *
 * Note the interaction with deploys: a stored choice WINS over DEFAULT_THEME, so once you have flipped
 * a device to warm, changing the shipped default will not appear to do anything there. That is correct
 * (a person's choice should outlast a deploy) but it means you must call owewell.reset() to check what
 * a new visitor actually sees.
 */
export function initTheme(): void {
  applyTheme(storedTheme());
  (window as unknown as { owewell: { theme: (n: ThemeName) => void; reset: () => void } }).owewell = {
    theme: (n: ThemeName) => applyTheme(n),
    reset: clearTheme,
  };
}
