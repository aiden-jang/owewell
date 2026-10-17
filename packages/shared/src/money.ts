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

/** Parse strings exactly to cents with at most two decimals; round numeric inputs.
 * Leading currency symbols and valid thousands grouping are accepted. */
export function dollarsToCents(value: number | string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new MoneyError(`Amount must be finite, got ${value}`);
    }
    return Math.round(value * 100);
  }

  // Strip a currency symbol only at the front. Grouping must be valid so "1,50" cannot become $150.
  const cleaned = value.trim().replace(/^(-?)\s*[$£€]\s*/, '$1');
  const match = /^(-)?(?:(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{0,2}))?|\.(\d{1,2}))$/.exec(cleaned);
  if (!match) {
    throw new MoneyError(`Invalid money string: "${value}"`);
  }
  const sign = match[1];
  const whole = (match[2] ?? '0').replace(/,/g, '');
  const fraction = match[3] ?? match[4] ?? '';
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

/** Largest-remainder allocation conserves total cents. A stable expense seed rotates tied remainders. */
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
