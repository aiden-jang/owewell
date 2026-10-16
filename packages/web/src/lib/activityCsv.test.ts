import { describe, expect, it } from 'vitest';
import { formatMoney } from '@owewell/shared';
import { activityCsv, csvCell, csvFileName } from './activityCsv';
import type { Expense } from './expenses';

const fmt = formatMoney;
const nameOf = (id: string) => ({ a: 'Alice', b: 'Bob' })[id] ?? 'Someone';

const expense = (
  over: Partial<Expense> & { id: string; description: string; amountCents: number },
): Expense => ({
  payerId: 'a',
  splitMethod: 'EQUAL',
  category: 'food',
  createdAt: '2026-08-10T12:00:00.000Z',
  date: '2026-08-10T12:00:00.000Z',
  note: null,
  version: 1,
  splits: [{ userId: 'a', owedCents: 0 }],
  ...over,
});

const rows = (csv: string) => csv.split('\r\n');

describe('escaping a cell', () => {
  it('leaves ordinary text alone', () => {
    expect(csvCell('Dinner at Nopa')).toBe('Dinner at Nopa');
  });

  it('quotes and doubles up anything that would break the shape', () => {
    expect(csvCell('Beer, wine')).toBe('"Beer, wine"');
    expect(csvCell('The "good" place')).toBe('"The ""good"" place"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  /*
   * The reason this function exists.
   *
   * Excel and Sheets evaluate a leading =, +, - or @ in an imported CSV, so an expense called
   * `=HYPERLINK(...)` becomes a live formula in whoever's spreadsheet. Descriptions and display
   * names are both typed by people, and one of those people might not be on your side.
   */
  it('defuses anything a spreadsheet would treat as a formula', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+44 dinner')).toBe("'+44 dinner");
    expect(csvCell('-5 refund')).toBe("'-5 refund");
    expect(csvCell('@lunch')).toBe("'@lunch");
  });

  it('defuses and escapes together', () => {
    expect(csvCell('=CONCAT("a","b")')).toBe('"\'=CONCAT(""a"",""b"")"');
  });
});

describe('the exported ledger', () => {
  const csv = activityCsv({
    expenses: [
      expense({ id: 'e1', description: 'Cab home', amountCents: 2_400, date: '2026-08-09T12:00:00.000Z' }),
      expense({ id: 'e2', description: 'Dinner', amountCents: 8_000, date: '2026-08-10T12:00:00.000Z' }),
    ],
    settlements: [
      {
        id: 's1',
        fromUserId: 'b',
        toUserId: 'a',
        amountCents: 4_000,
        method: 'venmo',
        createdAt: '2026-08-11T12:00:00.000Z',
      },
    ],
    balances: [
      { userId: 'b', displayName: 'Bob', netCents: -1_000, paidCents: 0, owedCents: 1_000 },
      { userId: 'a', displayName: 'Alice', netCents: 1_000, paidCents: 0, owedCents: 0 },
    ],
    nameOf,
    fmt,
  });

  it('leads with a header row', () => {
    expect(rows(csv)[0]).toBe('Date,Type,Description,Amount,Details');
  });

  it('puts expenses and payments on one timeline, oldest first', () => {
    const types = rows(csv)
      .slice(1)
      .map((r) => r.split(',')[1]);
    expect(types).toEqual(['Expense', 'Expense', 'Payment', 'Current balance', 'Current balance']);
  });

  // Balances are a footer, not events. They have no date to sort by, so they sort by name.
  it('ends with the balances, alphabetically', () => {
    const tail = rows(csv)
      .slice(-2)
      .map((r) => r.split(',')[2]);
    expect(tail).toEqual(['Alice', 'Bob']);
  });

  /*
   * The footer rows carry no date, and `new Date('')` is an Invalid Date — which used to print the
   * literal words "Invalid Date" into the Date column of every export.
   */
  it('leaves the date blank on the footer rows instead of printing a broken one', () => {
    for (const row of rows(csv).slice(-2)) {
      expect(row.startsWith(',Current balance')).toBe(true);
      expect(row).not.toContain('Invalid');
    }
  });

  it('resolves names and says which way the money went', () => {
    expect(csv).toContain('Bob → Alice');
    expect(csv).toContain('via Venmo');
    expect(csv).toContain('is owed');
    expect(csv).toContain('owes');
  });

  it('records a payment with no method as one anyway', () => {
    const plain = activityCsv({
      expenses: [],
      balances: [],
      nameOf,
      fmt,
      settlements: [
        {
          id: 's1',
          fromUserId: 'b',
          toUserId: 'a',
          amountCents: 100,
          method: null,
          createdAt: '2026-08-11T12:00:00.000Z',
        },
      ],
    });
    expect(plain).toContain('payment recorded');
  });
});

describe('the file it lands as', () => {
  const at = new Date(2026, 9, 15, 23, 59);
  it('slugs the group name', () => {
    expect(csvFileName('Tahoe Trip 2026', at)).toBe('tahoe-trip-2026-activity-2026-10-15.csv');
    expect(csvFileName('  Big Sur!  ', at)).toBe('big-sur-activity-2026-10-15.csv');
    expect(csvFileName('Big Sur', new Date(2026, 9, 16))).toBe('big-sur-activity-2026-10-16.csv');
  });

  // A group named entirely in emoji still has to produce a filename.
  it('falls back when the name slugs to nothing', () => {
    expect(csvFileName('🏔️🎿', at)).toBe('owewell-activity-2026-10-15.csv');
  });
});
