import { dollarsToCents } from '@owewell/shared';
import type { SplitMethod } from '@owewell/core';

/** Reject unparseable input before it reaches allocation; EQUAL has no per-person value. */
export function serverValue(method: SplitMethod, raw: string): number | undefined {
  const trimmed = raw.trim();
  if (method === 'EQUAL') return undefined;
  if (method === 'EXACT') return dollarsToCents(trimmed);
  if (method === 'PERCENT') {
    const pct = Number(trimmed);
    if (!Number.isFinite(pct)) throw new Error('bad percent');
    return Math.round(pct * 100);
  }
  const weight = Number(trimmed);
  if (!Number.isInteger(weight) || weight <= 0) throw new Error('bad share');
  return weight;
}
