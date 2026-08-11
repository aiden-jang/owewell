export interface SpendingPulse {
  currentCents: number;
  previousCents: number;
  change: 'up' | 'down' | 'flat' | 'new';
  percent: number | null;
}

interface DatedAmount {
  date: string;
  amountCents: number;
}

function monthKey(year: number, monthZeroBased: number): string {
  return `${year}-${String(monthZeroBased + 1).padStart(2, '0')}`;
}

/** Calendar-month comparison using the expense's YYYY-MM prefix, avoiding UTC date drift. */
export function spendingPulse(expenses: DatedAmount[], now = new Date()): SpendingPulse | null {
  const currentKey = monthKey(now.getFullYear(), now.getMonth());
  const previousDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousKey = monthKey(previousDate.getFullYear(), previousDate.getMonth());
  let currentCents = 0;
  let previousCents = 0;
  for (const expense of expenses) {
    const key = expense.date.slice(0, 7);
    if (key === currentKey) currentCents += expense.amountCents;
    else if (key === previousKey) previousCents += expense.amountCents;
  }
  if (currentCents === 0 && previousCents === 0) return null;
  if (previousCents === 0) return { currentCents, previousCents, change: 'new', percent: null };
  const percent = Math.round(((currentCents - previousCents) / previousCents) * 100);
  return {
    currentCents,
    previousCents,
    change: percent === 0 ? 'flat' : percent > 0 ? 'up' : 'down',
    percent,
  };
}

export function pulseLabel(pulse: SpendingPulse): string {
  if (pulse.change === 'new') return 'nothing last month';
  if (pulse.change === 'flat') return 'same as last month';
  return `${Math.abs(pulse.percent ?? 0)}% ${pulse.change === 'up' ? 'more' : 'less'} than last month`;
}
