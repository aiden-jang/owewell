import { describe, expect, it, vi } from 'vitest';
import { APP, PAGES, BROWSER_ACTIONS, isAnalyticsEvent, pageForPath } from '../../../analytics/schema.js';
import { handleAnalytics, writeAnalytics } from '../../../analytics/worker.js';
const request = (body: string, origin = 'https://example.test') =>
  new Request('https://example.test/api/analytics', {
    method: 'POST',
    headers: { Origin: origin },
    body,
  });

describe('anonymous aggregate analytics', () => {
  it('maps private paths to fixed categories without the code, query or fragment', () => {
    expect(pageForPath('/s/PRIVATE-LINK')).toBe('shared');
    expect(pageForPath('/not-a-public-category/PRIVATE')).toBe('other');
  });
  it('writes only the fixed app, event and page category', async () => {
    const writeDataPoint = vi.fn();
    const result = await handleAnalytics(request(JSON.stringify({ name: 'page_view', page: PAGES[0] })), {
      EVENTS: { writeDataPoint },
    });
    expect(result.status).toBe(204);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: [APP],
      blobs: [APP, 'page_view', PAGES[0], ''],
      doubles: [1, 0],
    });
  });
  it('rejects unknown categories and extra fields rather than storing private text', async () => {
    const writeDataPoint = vi.fn();
    for (const value of [
      null,
      [],
      { name: 'PRIVATE' },
      { name: 'page_view', page: '/r/PRIVATE' },
      { name: 'page_view', page: PAGES[0], note: 'PRIVATE' },
      { name: 'page_view', page: '__proto__' },
    ]) {
      expect(isAnalyticsEvent(value)).toBe(false);
      await handleAnalytics(request(JSON.stringify(value)), { EVENTS: { writeDataPoint } });
    }
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
  it('accepts every declared action without accepting an arbitrary event', async () => {
    const writeDataPoint = vi.fn();
    for (const name of BROWSER_ACTIONS) {
      await handleAnalytics(request(JSON.stringify({ name })), { EVENTS: { writeDataPoint } });
    }
    expect(writeDataPoint).toHaveBeenCalledTimes(BROWSER_ACTIONS.length);
  });
  it('refuses cross-origin and originless writes before reading their body', async () => {
    const writeDataPoint = vi.fn();
    expect(
      (await handleAnalytics(request('{}', 'https://other.test'), { EVENTS: { writeDataPoint } })).status,
    ).toBe(403);
    expect(
      (
        await handleAnalytics(
          new Request('https://example.test/api/analytics', { method: 'POST', body: '{}' }),
          {},
        )
      ).status,
    ).toBe(403);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
  it('bounds the actual body and declared length', async () => {
    expect((await handleAnalytics(request('x'.repeat(300)), {})).status).toBe(413);
    const oversized = request('{}');
    oversized.headers.set('Content-Length', '9999');
    expect((await handleAnalytics(oversized, {})).status).toBe(413);
  });
  it('uses a separate rate bucket and rejects before a dataset write', async () => {
    const req = request(JSON.stringify({ name: 'page_view', page: PAGES[0] }));
    req.headers.set('CF-Connecting-IP', '192.0.2.1');
    const limit = vi.fn().mockResolvedValue({ success: false });
    const writeDataPoint = vi.fn();
    expect(
      (await handleAnalytics(req, { EVENT_LIMITER: { limit }, EVENTS: { writeDataPoint } })).status,
    ).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: `${APP}:192.0.2.1` });
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
  it('handles missing bindings, malformed JSON and dataset failures without affecting the app', async () => {
    expect((await handleAnalytics(request('{'), {})).status).toBe(204);
    expect(
      (await handleAnalytics(request(JSON.stringify({ name: 'page_view', page: PAGES[0] })), {})).status,
    ).toBe(204);
    const env = {
      EVENTS: {
        writeDataPoint: () => {
          throw new Error('unavailable');
        },
      },
    };
    expect(() => writeAnalytics(env, { name: 'page_view', page: PAGES[0]! })).not.toThrow();
    expect(
      (await handleAnalytics(request(JSON.stringify({ name: 'page_view', page: PAGES[0] })), env)).status,
    ).toBe(204);
  });
});
