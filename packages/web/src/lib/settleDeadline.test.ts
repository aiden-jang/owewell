import { describe, expect, it, vi } from 'vitest';
import { deadlinePresets, deadlineStatus, settlementDeadlineCalendar } from './settleDeadline';

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
