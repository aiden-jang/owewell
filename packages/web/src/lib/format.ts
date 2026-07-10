import { dollarsToCents } from '@owewell/shared';

/**
 * Tidy a money input on blur: "20" → "20.00", "5.5" → "5.50". Leaves blank or
 * still-invalid/in-progress values untouched (so we never fight the user mid-type
 * or clobber something the parser would reject). No thousands separators — the
 * amount parser rejects commas, and displayed amounts are formatted separately.
 */
export function normalizeAmountInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  try {
    return (dollarsToCents(trimmed) / 100).toFixed(2);
  } catch {
    return raw;
  }
}
