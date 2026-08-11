import type { SuggestedPayment } from './settlements';

export type DeadlineTone = 'calm' | 'soon' | 'late';

export function deadlineStatus(settleBy: string, now = new Date()): { tone: DeadlineTone; label: string; hours: number } {
  const difference = new Date(settleBy).getTime() - now.getTime();
  const hours = Math.ceil(Math.abs(difference) / 3_600_000);
  if (difference < 0) return { tone: 'late', label: `${hours}h past settle-by`, hours: -hours };
  if (difference <= 24 * 3_600_000) return { tone: 'soon', label: `${Math.max(1, hours)}h to settle`, hours };
  const days = Math.ceil(hours / 24);
  return { tone: 'calm', label: `${days}d to settle`, hours };
}

export function deadlinePresets(now = new Date()): Array<{ label: string; value: Date }> {
  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);
  if (tonight <= now) tonight.setDate(tonight.getDate() + 1);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(18, 0, 0, 0);
  const weekend = new Date(now);
  const daysUntilSunday = (7 - weekend.getDay()) % 7 || 7;
  weekend.setDate(weekend.getDate() + daysUntilSunday);
  weekend.setHours(18, 0, 0, 0);
  return [
    { label: 'Tonight', value: tonight },
    { label: 'Tomorrow', value: tomorrow },
    { label: 'This weekend', value: weekend },
  ];
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function settlementDeadlineCalendar(groupName: string, settleBy: string, suggestions: SuggestedPayment[]): string {
  const due = new Date(settleBy);
  const start = new Date(due.getTime() - 15 * 60_000);
  const description = suggestions.length
    ? suggestions.map(payment => `${payment.fromName} pays ${payment.toName} $${(payment.amountCents / 100).toFixed(2)}`).join('\n')
    : 'Open owewell to review the tab.';
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//owewell//Settle By//EN', 'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@owewell`, `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(due)}`,
    `SUMMARY:${escapeIcs(`Settle up: ${groupName}`)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Time to settle up', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
