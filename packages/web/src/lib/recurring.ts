import { api } from './api';

/**
 * Bills that come round again.
 *
 * Every call carries `today` as the browser's own calendar date. The API runs in UTC, and at 8pm in
 * California the server's date is already tomorrow, so a rent rule anchored on the 1st would come due
 * on the evening of the 31st for anybody west of UTC. The device is the only thing here that knows
 * which day it actually is where the person is standing.
 */

export type Cadence = 'weekly' | 'monthly';

export interface RecurringRule {
  id: string;
  description: string;
  amountCents: number;
  payerId: string;
  category: string | null;
  cadence: Cadence;
  startsOn: string;
  participantIds: string[];
  active: boolean;
  /** "every month on the 1st", ready to drop into a sentence. */
  cadenceLabel: string;
  nextOn: string;
  /** Due and not yet dealt with, oldest first. Empty is the normal state. */
  dueDates: string[];
  truncated: boolean;
}

export interface CreateRecurringPayload {
  description: string;
  amountCents: number;
  payerId: string;
  category?: string | null;
  cadence: Cadence;
  startsOn: string;
  participantIds: string[];
  handledThrough?: string | null;
}

/** The device's calendar date, not an instant. `toISOString` would hand back UTC's idea of today. */
export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const withToday = (path: string): string =>
  `${path}${path.includes('?') ? '&' : '?'}today=${encodeURIComponent(localToday())}`;

export const recurringApi = {
  list: (groupId: string): Promise<RecurringRule[]> =>
    api.get<{ rules: RecurringRule[] }>(withToday(`/groups/${groupId}/recurring`)).then((r) => r.rules),
  create: (groupId: string, body: CreateRecurringPayload): Promise<RecurringRule> =>
    api.post<{ rule: RecurringRule }>(withToday(`/groups/${groupId}/recurring`), body).then((r) => r.rule),
  accept: (groupId: string, ruleId: string, on: string): Promise<RecurringRule> =>
    api
      .post<{ rule: RecurringRule }>(withToday(`/groups/${groupId}/recurring/${ruleId}/accept`), { on })
      .then((r) => r.rule),
  skip: (groupId: string, ruleId: string, on: string): Promise<RecurringRule> =>
    api
      .post<{ rule: RecurringRule }>(withToday(`/groups/${groupId}/recurring/${ruleId}/skip`), { on })
      .then((r) => r.rule),
  setActive: (groupId: string, ruleId: string, active: boolean): Promise<RecurringRule> =>
    api
      .patch<{ rule: RecurringRule }>(withToday(`/groups/${groupId}/recurring/${ruleId}`), { active })
      .then((r) => r.rule),
};
