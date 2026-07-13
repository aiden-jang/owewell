import { describe, expect, it } from 'vitest';
import { SPLIT_METHODS, splitMethodHint, splitMethodUnit } from './splitMethods';

describe('splitMethods', () => {
  it('covers all four methods', () => {
    expect(SPLIT_METHODS.map((m) => m.value)).toEqual(['EQUAL', 'SHARES', 'PERCENT', 'EXACT']);
  });

  it('maps each method to its per-person input unit', () => {
    expect(splitMethodUnit('EQUAL')).toBe('');
    expect(splitMethodUnit('SHARES')).toBe('shares');
    expect(splitMethodUnit('PERCENT')).toBe('%');
    expect(splitMethodUnit('EXACT')).toBe('$');
  });

  it('gives a non-empty explainer for the non-obvious methods', () => {
    expect(splitMethodHint('SHARES')).toMatch(/weight/i);
    expect(splitMethodHint('PERCENT')).toMatch(/100/);
    expect(splitMethodHint('EXACT')).toMatch(/exact/i);
    expect(splitMethodHint('EQUAL')).not.toBe('');
  });
});
