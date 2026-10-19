import type { Env } from './env.js';

/*
 * One dataset across every app, so the columns mean the same thing everywhere:
 *   index1/blob1 app   blob2 event   blob3 variant   blob4 detail
 *   double1 count (always 1)   double2 magnitude
 */
const APP = 'owewell';

export function writeEvent(env: Env, name: string, variant = '', detail = '', magnitude = 0): void {
  if (!env.EVENTS) return;
  try {
    env.EVENTS.writeDataPoint({
      indexes: [APP],
      blobs: [APP, name, variant.slice(0, 64), detail.slice(0, 64)],
      doubles: [1, magnitude],
    });
  } catch {
    /* Aggregate counters are best effort and must not fail product actions. */
  }
}
