import { APP, isBrowserAnalyticsEvent, isAnalyticsEvent, type AnalyticsEvent } from './schema.js';

export interface AnalyticsBindings {
  EVENTS?: { writeDataPoint(point: { indexes: string[]; blobs: string[]; doubles: number[] }): void };
  EVENT_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

/** Fixed categories only; telemetry must never change a successful product operation. */
export function writeAnalytics(env: AnalyticsBindings, event: AnalyticsEvent): void {
  if (!isAnalyticsEvent(event)) return;
  try {
    env.EVENTS?.writeDataPoint({
      indexes: [APP],
      blobs: [APP, event.name, event.name === 'page_view' ? event.page : '', ''],
      doubles: [1, 0],
    });
  } catch {
    /* Analytics is best effort, including a temporarily unavailable binding. */
  }
}

const response = (status = 204) =>
  new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });

/** Anonymous, bounded and separate from account or room storage. */
export async function handleAnalytics(request: Request, env: AnalyticsBindings): Promise<Response> {
  if (request.method !== 'POST') return response(405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return response(403);
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 256)) return response(413);
  try {
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip && env.EVENT_LIMITER && !(await env.EVENT_LIMITER.limit({ key: `${APP}:${ip}` })).success)
      return response(429);
    if (!request.body) return response();
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256) {
          await reader.cancel();
          return response(413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const event: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
    );
    if (isBrowserAnalyticsEvent(event)) writeAnalytics(env, event);
  } catch {
    /* A dropped event must not break navigation or expose the request in logs. */
  }
  return response();
}
