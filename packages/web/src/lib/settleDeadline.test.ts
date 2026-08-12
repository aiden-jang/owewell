import { describe, expect, it, vi } from 'vitest';
import { deadlinePresets, deadlineState, deadlineStatus, settlementDeadlineCalendar } from './settleDeadline';

describe('settle-by deadlines', () => {
  it('labels future, urgent, and overdue deadlines', () => {
    const now = new Date('2026-08-11T12:00:00Z');
    expect(deadlineStatus('2026-08-13T12:00:00Z', now).tone).toBe('calm');
    expect(deadlineStatus('2026-08-11T18:00:00Z', now)).toMatchObject({ tone: 'soon', hours: 6 });
    expect(deadlineStatus('2026-08-11T10:00:00Z', now).tone).toBe('late');
  });

  it('offers only future preset times', () => {
    const now = new Date('2026-08-11T21:00:00');
    expect(deadlinePresets(now).every(preset => preset.value > now)).toBe(true);
  });

  it('creates a calendar reminder containing the settle-up plan', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'event-id' });
    const calendar = settlementDeadlineCalendar('Beach, trip', '2026-08-20T22:00:00Z', [{
      fromUserId: 'a', fromName: 'Alex', toUserId: 'b', toName: 'Blair', amountCents: 4250,
    }]);
    expect(calendar).toContain('SUMMARY:Settle up: Beach\\, trip');
    expect(calendar).toContain('Alex pays Blair $42.50');
    expect(calendar).toContain('BEGIN:VALARM');
    vi.unstubAllGlobals();
  });
});

/*
 * Whether a finish line currently applies is read from the balances, not stored.
 *
 * Recording a payment used to null the deadline in the database, which only covered one of the several
 * writes that can empty a ledger: deleting the last expense, deleting an overpayment, and a recurring bill
 * that offsets a debt all reach zero too, and all of them left the deadline nagging about money nobody
 * owed. It also threw the owner's finish line away, so a group that settled mid-trip and kept spending had
 * nothing left to settle by.
 */
describe('whether the finish line applies right now', () => {
  const now = new Date('2026-08-11T12:00:00Z');

  it('has nothing to be late for once everyone has paid up', () => {
    const past = '2026-08-10T12:00:00Z';
    expect(deadlineStatus(past, now).tone).toBe('late');
    expect(deadlineState(past, 0, now).tone).toBe('calm');
    expect(deadlineState(past, 0, now).label).toBe('nothing outstanding');
  });

  it('still counts down while somebody owes something', () => {
    expect(deadlineState('2026-08-11T18:00:00Z', 1, now)).toMatchObject({ tone: 'soon', hours: 6 });
  });

  it('comes back when the tab reopens, because the deadline was never thrown away', () => {
    // A group that settles mid-trip and keeps spending gets its own finish line back.
    const settleBy = '2026-08-13T12:00:00Z';
    expect(deadlineState(settleBy, 0, now).label).toBe('nothing outstanding');
    expect(deadlineState(settleBy, 2, now).tone).toBe('calm');
    expect(deadlineState(settleBy, 2, now).label).toBe('2d to settle');
  });
});
