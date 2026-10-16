import { dollarsToCents } from '@owewell/shared';

/**
 * Today as YYYY-MM-DD in the user's own timezone.
 *
 * Never `toISOString().slice(0, 10)`, which is UTC: on a phone in California at 8pm that returns
 * tomorrow, so an expense added on Friday evening files itself under Saturday. Expense dates are picked
 * and stored as local calendar dates, and anything comparing against them has to agree about which day
 * it is.
 */
export function todayStr(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Tidy a money input on blur: "20" → "20.00", "5.5" → "5.50". Leaves blank or
 * still-invalid/in-progress values untouched (so we never fight the user mid-type
 * or clobber something the parser would reject). Displayed amounts are formatted separately.
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
