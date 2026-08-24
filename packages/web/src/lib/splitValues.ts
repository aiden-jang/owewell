import { dollarsToCents } from '@owewell/shared';
import type { SplitMethod } from '@owewell/core';

/**
 * Turn one raw per-person input into the number the server wants.
 *
 * Throws rather than returning a sentinel: every caller is inside a try that already knows how to
 * say "check the amounts", and a NaN travelling on into a split is the failure this prevents.
 * EQUAL has no per-person value at all, hence undefined.
 */
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
