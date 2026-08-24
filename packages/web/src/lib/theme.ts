import type { ThemeName } from './contrast.js';

/**
 * Which palette is on.
 *
 * Exists so the direction can be decided by looking at real groups and real numbers rather than at a
 * mock with a group called "Tahoe trip". Everything is CSS variables, so switching is one attribute and
 * costs nothing — the palette is the cheap decision and this keeps it cheap.
 *
 * Set it from the footer, or from the console:  owewell.theme('warm')
 */

const KEY = 'owewell:theme';

/**
 * What a first visit gets, when the device has an opinion and the person has not expressed one.
 *
 * Shipping 'warm' unconditionally meant someone whose phone is in dark mode got a white app until
 * they found a console. The OS setting is the closest thing to a stated preference that exists
 * before anybody touches anything, so it wins over the shipped default and loses to a real choice.
 */
function preferredTheme(): ThemeName {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'warm';
  } catch {
    return 'warm';
  }
}

/*
 * Paint it. Deliberately does NOT remember it.
 *
 * This used to write to localStorage on every call, which was harmless while the only caller was a
 * console command. It stopped being harmless the moment boot started deriving a theme from the
 * device: the first paint persisted that derivation as though it were a decision, so someone who
 * later switched their phone to dark stayed on the palette their phone had the day they first
 * opened the app. Remembering is `setTheme`, and only a person calls that.
 */
function applyTheme(name: ThemeName): void {
  document.documentElement.dataset.theme = name;
  /*
   * The address-bar / status-bar colour has to follow, or a light theme gets a black notch on iOS.
   *
   * All of them, and their `media` stripped. index.html ships two of these scoped to
   * prefers-color-scheme so the bar is right before any of this runs; the moment the palette is a
   * choice rather than a guess, the device's opinion stops being relevant and a scoped tag would
   * keep overriding this one.
   */
  const color =
    getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim() || '#0b0b0d';
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', color);
    meta.removeAttribute('media');
  }
}

function storedTheme(): ThemeName {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'dark' || v === 'warm') return v;
  } catch {
    // ignore
  }
  return preferredTheme();
}

/** Forget the local override and go back to following the device. */
function clearTheme(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  applyTheme(preferredTheme());
}

/** Whatever is on right now. Read at mount by the footer switch. */
export function currentTheme(): ThemeName {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'warm';
}

const listeners = new Set<(name: ThemeName) => void>();

/** Notified on every change, including the ones made from the console. */
export function onThemeChange(fn: (name: ThemeName) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Set the palette and remember it. A stated choice outlasts both the device and a deploy. */
export function setTheme(name: ThemeName): void {
  applyTheme(name);
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // Private mode, or storage disabled. The theme still applies for this session.
  }
  for (const fn of listeners) fn(name);
}

/**
 * Call once at boot, before the app paints, so there is no flash of the wrong palette.
 *
 * The console handles stay, because they can do one thing the footer switch cannot: `reset()` drops
 * the stored choice entirely and hands the decision back to the device. That is the only way to see
 * what a first-time visitor actually gets, and a stored choice otherwise wins forever.
 *
 *   owewell.theme('warm')   try the warm palette on this device
 *   owewell.reset()         forget the choice and follow the OS again
 */
export function initTheme(): void {
  applyTheme(storedTheme());
  (window as unknown as { owewell: { theme: (n: ThemeName) => void; reset: () => void } }).owewell = {
    theme: (n: ThemeName) => setTheme(n),
    reset: () => {
      clearTheme();
      for (const fn of listeners) fn(currentTheme());
    },
  };
}
