/**
 * Money handling (integer cents).
 *
 * Everything is integer cents. Floating-point dollars (0.1 + 0.2 !== 0.3) have no
 * place in a money app, so {@link Money} never stores a fractional amount, and the
 * only way to create one from a decimal is through careful string/number parsing.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer, got ${value}`);
  }
}

/**
 * Parse a dollar amount into integer cents without floating-point drift.
 *
 * Strings are parsed exactly (at most two decimal places). Numbers are rounded,
 * which is safe for trusted/computed values but should not be fed raw user text.
 */
export function dollarsToCents(value: number | string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new MoneyError(`Amount must be finite, got ${value}`);
    }
    return Math.round(value * 100);
  }

  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new MoneyError(`Invalid money string: "${value}"`);
  }
  const sign = match[1];
  const whole = match[2];
  const fraction = match[3] ?? '';
  if (whole === undefined) {
    throw new MoneyError(`Invalid money string: "${value}"`);
  }
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return sign ? -cents : cents;
}

/** FNV-1a, 32-bit. Stable across processes, unlike anything built on object iteration order. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Split `total` cents across `weights` using the largest-remainder method.
 *
 * The returned amounts are always whole cents and always sum exactly to `total`, so a split never
 * loses or invents a penny. Leftover cents go to the entries with the largest fractional share first.
 *
 * `seed` decides who wins a tie, and it matters more than it looks. On an equal split every fractional
 * share is identical, so the tie-break is the ONLY thing that picks who absorbs the odd cent. Breaking
 * ties by plain index meant the first participant absorbed it on every uneven bill, so whoever was
 * listed first (in practice the group owner) quietly ended up owing a cent more per uneven expense.
 * Real symptom: two members on the same five expenses ended up 2 cents apart.
 *
 * Passing a stable per-expense seed rotates the starting point, so the odd cent moves around and the
 * bias evens out over many expenses. It stays fully deterministic: the same seed always gives the same
 * answer, so recomputing an expense never changes it. Omitting the seed keeps the old index order.
 */
export function allocateCents(total: number, weights: readonly number[], seed?: string | number): number[] {
  assertSafeInteger(total, 'total');
  if (total < 0) {
    throw new MoneyError(`Cannot allocate a negative total (${total})`);
  }
  if (weights.length === 0) {
    throw new MoneyError('Cannot allocate across zero weights');
  }
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new MoneyError('Weights must be finite and non-negative');
  }

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) {
    throw new MoneyError('Total weight must be greater than zero');
  }

  const ideal = weights.map((w) => (total * w) / totalWeight);
  const result = ideal.map((value) => Math.floor(value));
  const distributed = result.reduce((sum, c) => sum + c, 0);
  let remainder = total - distributed;

  // Rotate the tie-break start by the seed. FNV-1a over the string form: small, stable across runs,
  // and nothing here needs cryptographic quality, only that the same seed lands the same way.
  const n = weights.length;
  const offset = seed === undefined ? 0 : fnv1a(String(seed)) % n;
  const rank = (index: number): number => (index - offset + n) % n;

  const byLargestFraction = ideal
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || rank(a.index) - rank(b.index));

  let cursor = 0;
  while (remainder > 0) {
    const slot = byLargestFraction[cursor % byLargestFraction.length];
    if (slot) {
      result[slot.index] = (result[slot.index] ?? 0) + 1;
    }
    cursor += 1;
    remainder -= 1;
  }

  return result;
}

/** An immutable amount of money, stored as integer cents. */
export class Money {
  private constructor(private readonly _cents: number) {}

  static fromCents(cents: number): Money {
    assertSafeInteger(cents, 'cents');
    return new Money(cents);
  }

  static fromDollars(value: number | string): Money {
    return new Money(dollarsToCents(value));
  }

  static zero(): Money {
    return new Money(0);
  }

  get cents(): number {
    return this._cents;
  }

  add(other: Money): Money {
    return Money.fromCents(this._cents + other._cents);
  }

  subtract(other: Money): Money {
    return Money.fromCents(this._cents - other._cents);
  }

  /** Scale by a unitless factor (e.g. tax rate), rounding to the nearest cent. */
  multiply(scalar: number): Money {
    if (!Number.isFinite(scalar)) {
      throw new MoneyError(`Scalar must be finite, got ${scalar}`);
    }
    return Money.fromCents(Math.round(this._cents * scalar));
  }

  /** Split this amount across `weights`, never losing or inventing a cent. */
  allocate(weights: readonly number[]): Money[] {
    return allocateCents(this._cents, weights).map((c) => new Money(c));
  }

  equals(other: Money): boolean {
    return this._cents === other._cents;
  }

  compareTo(other: Money): number {
    return Math.sign(this._cents - other._cents);
  }

  isZero(): boolean {
    return this._cents === 0;
  }

  isNegative(): boolean {
    return this._cents < 0;
  }

  format(options: { currency?: string; locale?: string } = {}): string {
    const { currency = 'USD', locale = 'en-US' } = options;
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(this._cents / 100);
  }

  /** Serialize as integer cents so it survives JSON round-trips losslessly. */
  toJSON(): number {
    return this._cents;
  }

  toString(): string {
    return this.format();
  }
}
