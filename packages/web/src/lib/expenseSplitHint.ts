import type { Expense } from './expenses';
import { dollarsToCents, type SplitMethod } from '@owewell/shared';
import type { GroupMember } from './groups';

/** Reconcile per-person input before saving, using cents for exact amounts. */
export function expenseSplitHint(
  method: SplitMethod,
  amount: string,
  values: Record<string, string>,
  chosen: GroupMember[],
  fmt: (cents: number) => string,
): { text: string; tone: string } | null {
  let splitHint: { text: string; tone: string } | null = null;
  if (method !== 'EQUAL') {
    const raws = chosen.map((m) => (values[m.userId] ?? '').trim()).filter(Boolean);
    if (method === 'EXACT') {
      let sum = 0;
      let ok = true;
      for (const raw of raws) {
        try {
          sum += dollarsToCents(raw);
        } catch {
          ok = false;
        }
      }
      let target = 0;
      try {
        target = amount.trim() ? dollarsToCents(amount) : 0;
      } catch {
        target = 0;
      }
      const tone = !ok
        ? 'text-neg'
        : target > 0 && sum === target
          ? 'text-pos'
          : sum > target
            ? 'text-neg'
            : 'text-muted';
      splitHint = { text: `${fmt(sum)} of ${fmt(target)} assigned`, tone };
    } else if (method === 'PERCENT') {
      let sum = 0;
      let ok = true;
      for (const raw of raws) {
        const n = Number(raw);
        if (Number.isFinite(n)) sum += n;
        else ok = false;
      }
      const rounded = Math.round(sum * 100) / 100;
      const tone = !ok
        ? 'text-neg'
        : rounded === 100
          ? 'text-pos'
          : rounded > 100
            ? 'text-neg'
            : 'text-muted';
      splitHint = { text: `${rounded}% of 100%`, tone };
    } else {
      let sum = 0;
      for (const raw of raws) {
        const n = Number(raw);
        if (Number.isFinite(n)) sum += n;
      }
      splitHint = { text: `${sum} share${sum === 1 ? '' : 's'} total`, tone: 'text-muted' };
    }
  }

  return splitHint;
}

/** Reverse the form's value encoding so an edited expense prefills what the payer entered. */
export function initialValues(editing: Expense | undefined): Record<string, string> {
  if (!editing || editing.splitMethod === 'ITEMIZED' || editing.splitMethod === 'EQUAL') return {};
  const method = editing.splitMethod;
  const out: Record<string, string> = {};
  for (const s of editing.splits) {
    if (s.inputValue == null) continue;
    if (method === 'EXACT') out[s.userId] = (s.inputValue / 100).toFixed(2);
    else if (method === 'PERCENT') out[s.userId] = String(s.inputValue / 100);
    else out[s.userId] = String(s.inputValue); // SHARES
  }
  return out;
}
