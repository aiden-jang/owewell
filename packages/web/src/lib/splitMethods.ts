import type { SplitMethod } from '@owewell/shared';

/**
 * Split-method metadata shared by the group and quick-split forms: the dropdown label, the unit
 * shown next to each per-person input, and a one-line explainer so SHARES / PERCENT / EXACT aren't
 * a guess the first time someone meets them.
 */
export const SPLIT_METHODS: { value: SplitMethod; label: string; unit: string; hint: string }[] = [
  { value: 'EQUAL', label: 'Equally', unit: '', hint: 'Everyone chips in the same amount.' },
  {
    value: 'SHARES',
    label: 'By shares',
    unit: 'shares',
    hint: 'Weights, not dollars. 2 and 1 means the first person pays twice as much.',
  },
  { value: 'PERCENT', label: 'By percent', unit: '%', hint: "Each person's percentage, adding up to 100." },
  { value: 'EXACT', label: 'Exact amounts', unit: '$', hint: "Type each person's exact dollar amount." },
];

const byValue = (m: SplitMethod): (typeof SPLIT_METHODS)[number] | undefined =>
  SPLIT_METHODS.find((x) => x.value === m);

export const splitMethodUnit = (m: SplitMethod): string => byValue(m)?.unit ?? '';
export const splitMethodHint = (m: SplitMethod): string => byValue(m)?.hint ?? '';
