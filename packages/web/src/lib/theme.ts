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
 * The palette the static assets are built against.
 *
 * A favicon, a PWA splash and an OG card are fetched once, by a crawler or an installer, with no
 * person and no localStorage behind them — they cannot follow a device or a choice, so one palette
 * has to be committed. `scripts/og.mjs` reads this identifier out of this file, so the share card
 * cannot disagree with the app. It also backstops `preferredTheme()` where matchMedia is missing.
 */
export const SHIPPED_THEME: ThemeName = 'warm';

/**
 * What a first visit gets, when the device has an opinion and the person has not expressed one.
 *
 * Shipping 'warm' unconditionally meant someone whose phone is in dark mode got a white app until
 * they found a console. The OS setting is the closest thing to a stated preference that exists
 * before anybody touches anything, so it wins over the shipped default and loses to a real choice.
 */
function preferredTheme(): ThemeName {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : SHIPPED_THEME;
  } catch {
    return SHIPPED_THEME;
  }
}

/*
 * Paint it. Deliberately does NOT remember it.
 *
 * Boot derives a theme from the device, so persisting here would record that derivation as a
 * decision — and someone who later switched their phone to dark would stay on the palette their
 * phone had the day they installed. Remembering is `setTheme`, and only a person calls that.
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
  const color = getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim() || '#18161f';
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
 * The console handles stay because they do one thing the footer switch cannot: `reset()` drops the
 * stored choice and hands the decision back to the device, which is the only way to see what a
 * first-time visitor gets.
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
