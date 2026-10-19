import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reportAnalytics } from '../../../analytics/browser.js';
import { HOST, PAGES, type AnalyticsEvent } from '../../../analytics/schema.js';
beforeEach(() => {
  vi.stubGlobal('window', { location: { hostname: HOST } });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});
afterEach(() => vi.unstubAllGlobals());
it('sends only fixed categories without cookies or private Referer URLs', () => {
  reportAnalytics({ name: 'page_view', page: PAGES[0]! });
  expect(fetch).toHaveBeenCalledWith(
    '/api/analytics',
    expect.objectContaining({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      keepalive: true,
      body: JSON.stringify({ name: 'page_view', page: PAGES[0] }),
    }),
  );
});
it('does not report from development or preview hosts', () => {
  vi.stubGlobal('window', { location: { hostname: 'localhost' } });
  reportAnalytics({ name: 'page_view', page: PAGES[0]! });
  expect(fetch).not.toHaveBeenCalled();
});
it('honors GPC and Do Not Track', () => {
  for (const preference of [{ globalPrivacyControl: true }, { doNotTrack: '1' }]) {
    vi.stubGlobal('navigator', preference);
    reportAnalytics({ name: 'page_view', page: PAGES[0]! });
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('refuses a private value or extra field before it reaches the network', () => {
  for (const value of [
    { name: 'page_view', page: '/r/PRIVATE' },
    { name: 'page_view', page: PAGES[0], note: 'PRIVATE' },
  ])
    reportAnalytics(value as AnalyticsEvent);
  expect(fetch).not.toHaveBeenCalled();
});
it('an offline rejection or blocked transport never interrupts an action', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  expect(() => reportAnalytics({ name: 'page_view', page: PAGES[0]! })).not.toThrow();
  await Promise.resolve();
  vi.stubGlobal('fetch', () => {
    throw new Error('blocked');
  });
  expect(() => reportAnalytics({ name: 'page_view', page: PAGES[0]! })).not.toThrow();
});
