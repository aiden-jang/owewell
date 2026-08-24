import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who decides the palette, and in what order.
 *
 * Three parties want a say: the device, a choice the person made once, and the code. The rule is
 * that a stated choice beats the device and the device beats the shipped default — and, the part
 * that is easy to get wrong, following the device must not look like a choice. An early version of
 * this persisted the device-derived value on first paint, which froze the palette to whatever the
 * phone happened to be set to the day the app was first opened.
 */

const KEY = 'owewell:theme';

function osPrefersDark(dark: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark && query.includes('dark'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

async function boot() {
  vi.resetModules();
  const mod = await import('./theme');
  mod.initTheme();
  return mod;
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('what a first visit gets', () => {
  it('follows a dark device', async () => {
    osPrefersDark(true);
    await boot();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('follows a light device', async () => {
    osPrefersDark(false);
    await boot();
    expect(document.documentElement.dataset.theme).toBe('warm');
  });

  /*
   * The one that regressed. Writing the device's answer to storage turns "no opinion yet" into a
   * decision the person never made, and the app stops following their phone forever after.
   */
  it('does not record the device as a choice', async () => {
    osPrefersDark(true);
    await boot();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('a choice, once made', () => {
  it('outlives the device', async () => {
    osPrefersDark(true);
    const { setTheme } = await boot();
    setTheme('warm');
    expect(localStorage.getItem(KEY)).toBe('warm');

    osPrefersDark(true);
    await boot();
    expect(document.documentElement.dataset.theme).toBe('warm');
  });

  it('reaches anything watching, including the console handles', async () => {
    osPrefersDark(false);
    const { onThemeChange, setTheme } = await boot();
    const seen: string[] = [];
    onThemeChange((n) => seen.push(n));
    setTheme('dark');
    expect(seen).toEqual(['dark']);
  });

  // The only way back to following the device, which is also the only way to see a first visit.
  it('can be given back', async () => {
    osPrefersDark(true);
    const { setTheme } = await boot();
    setTheme('warm');

    (window as unknown as { owewell: { reset: () => void } }).owewell.reset();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
