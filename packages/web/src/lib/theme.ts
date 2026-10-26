import type { ThemeName } from './contrast.js';

const KEY = 'owewell:theme';

/** Palette for static assets; the share-card generator also reads this identifier. */
export const SHIPPED_THEME: ThemeName = 'warm';

function preferredTheme(): ThemeName {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : SHIPPED_THEME;
  } catch {
    return SHIPPED_THEME;
  }
}

// Painting the inferred device theme must not persist it as an explicit user choice.
function applyTheme(name: ThemeName): void {
  document.documentElement.dataset.theme = name;
  // A chosen theme overrides every OS-scoped theme-color tag, including the iOS address bar.
  const color = getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim() || '#151d1e';
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

/** Initialize theme controls; the reset helper clears the explicit choice and follows the OS. */
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
