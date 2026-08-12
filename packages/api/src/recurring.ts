import { and, asc, eq } from 'drizzle-orm';
import { CADENCES, cadenceLabel, dueOccurrences, nextOccurrenceAfter, parseYmd, type Cadence } from '@owewell/shared';
import type { DB } from './db/client.js';
import { recurringRules } from './db/schema.js';
import { createExpense, ExpenseError, memberPersonIds } from './expenses.js';
import { requireMembership } from './groups.js';

/*
 * Permissions and proposals; the scheduling maths is in @owewell/shared so it can be property-tested.
 *
 * The rule a future change is most likely to break: a rule never creates an expense on its own. Due
 * occurrences are proposed and somebody taps to accept, or balances move while nobody is looking.
 */

export type RecurringErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_CADENCE'
  | 'INVALID_DATE'
  | 'INVALID_PAYER'
  | 'INVALID_PARTICIPANT'
  | 'NO_PARTICIPANTS'
  | 'INVALID_AMOUNT';

export class RecurringRuleError extends Error {
  constructor(
    readonly code: RecurringErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RecurringRuleError';
  }
}

export interface RecurringRuleView {
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
  /** When the schedule next comes round, whatever has been handled so far. */
  nextOn: string;
  /** Occurrences due now and not yet dealt with, oldest first. */
  dueDates: string[];
  /** True when older overdue occurrences were dropped to keep the card readable. */
  truncated: boolean;
}

export interface CreateRecurringInput {
  description: string;
  amountCents: number;
  payerId: string;
  category?: string | null;
  cadence: string;
  startsOn: string;
  participantIds: string[];
  /**
   * Treat everything up to and including this date as already dealt with.
   *
   * Set when a rule is created from an expense that already exists, so the bill somebody just entered
   * by hand is not immediately proposed back to them as due.
   */
  handledThrough?: string | null;
}

/**
 * A YYYY-MM-DD occurrence as the instant the expense happened.
 *
 * Midday UTC rather than midnight, because the row stores a timestamp and the feed shows a date. Any
 * offset from UTC-11 to UTC+12 still renders the same calendar day at midday; at midnight UTC the whole
 * of the Americas reads it as the day before, so rent accepted for the 1st would appear on the 31st.
 */
function calendarDate(ymd: string): Date {
  return new Date(`${ymd}T12:00:00.000Z`);
}

function parseParticipants(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function toView(row: typeof recurringRules.$inferSelect, today: string): RecurringRuleView {
  const rule = { cadence: row.cadence as Cadence, startsOn: row.startsOn, lastHandledOn: row.lastHandledOn };
  // A stopped rule keeps its history and its label, and proposes nothing.
  const due = row.active ? dueOccurrences(rule, today) : { dates: [], truncated: false };
  return {
    id: row.id,
    description: row.description,
    amountCents: row.amountCents,
    payerId: row.payerId,
    category: row.category,
    cadence: rule.cadence,
    startsOn: row.startsOn,
    participantIds: parseParticipants(row.participantIds),
    active: row.active,
    cadenceLabel: cadenceLabel(rule),
    nextOn: nextOccurrenceAfter(rule, today),
    dueDates: due.dates,
    truncated: due.truncated,
  };
}

export async function listRecurringRules(
  db: DB,
  personId: string,
  groupId: string,
  today: string,
): Promise<RecurringRuleView[]> {
  await requireMembership(db, personId, groupId);
  const rows = await db
    .select()
    .from(recurringRules)
    .where(eq(recurringRules.groupId, groupId))
    .orderBy(asc(recurringRules.createdAt));
  return rows.map((row) => toView(row, today));
}

export async function createRecurringRule(
  db: DB,
  personId: string,
  groupId: string,
  input: CreateRecurringInput,
  today: string,
): Promise<RecurringRuleView> {
  await requireMembership(db, personId, groupId);
  if (!(CADENCES as readonly string[]).includes(input.cadence)) {
    throw new RecurringRuleError('INVALID_CADENCE', 'Pick weekly or monthly.');
  }
  // parseYmd is strict about real calendar dates, so 31 February never becomes a rule.
  try {
    parseYmd(input.startsOn);
    if (input.handledThrough) parseYmd(input.handledThrough);
  } catch {
    throw new RecurringRuleError('INVALID_DATE', 'That is not a real date.');
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new RecurringRuleError('INVALID_AMOUNT', 'The amount has to be more than zero.');
  }

  const members = await memberPersonIds(db, groupId);
  if (!members.has(input.payerId)) {
    throw new RecurringRuleError('INVALID_PAYER', 'The payer has to be in the group.');
  }
  const participants = [...new Set(input.participantIds)];
  if (participants.length === 0) throw new RecurringRuleError('NO_PARTICIPANTS', 'Pick who it splits between.');
  if (participants.some((id) => !members.has(id))) {
    throw new RecurringRuleError('INVALID_PARTICIPANT', 'Everyone it splits between has to be in the group.');
  }

  const id = crypto.randomUUID();
  await db.insert(recurringRules).values({
    id,
    groupId,
    createdById: personId,
    description: input.description.trim().slice(0, 120) || 'Recurring expense',
    amountCents: input.amountCents,
    payerId: input.payerId,
    category: input.category ?? null,
    cadence: input.cadence,
    startsOn: input.startsOn,
    lastHandledOn: input.handledThrough ?? null,
    participantIds: JSON.stringify(participants),
    active: true,
  });

  const row = await db.select().from(recurringRules).where(eq(recurringRules.id, id)).get();
  if (!row) throw new RecurringRuleError('NOT_FOUND', 'Could not read the rule back.');
  return toView(row, today);
}

async function loadActive(db: DB, groupId: string, ruleId: string) {
  const row = await db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.id, ruleId), eq(recurringRules.groupId, groupId)))
    .get();
  if (!row) throw new RecurringRuleError('NOT_FOUND', 'That repeating expense is gone.');
  return row;
}

/**
 * Add the expense for one due occurrence.
 *
 * `on` has to be a date the rule actually proposed. Without that check the endpoint would be a way to
 * post an expense at any date you like with a rule as cover, and, worse, would let the same occurrence
 * be added twice by anyone who kept the old response around.
 */
export async function acceptOccurrence(
  db: DB,
  personId: string,
  groupId: string,
  ruleId: string,
  on: string,
  today: string,
): Promise<RecurringRuleView> {
  await requireMembership(db, personId, groupId);
  const row = await loadActive(db, groupId, ruleId);
  const due = dueOccurrences(
    { cadence: row.cadence as Cadence, startsOn: row.startsOn, lastHandledOn: row.lastHandledOn },
    today,
  );
  if (!row.active || !due.dates.includes(on)) {
    throw new RecurringRuleError('INVALID_DATE', 'That one is not due.');
  }

  const participants = parseParticipants(row.participantIds).map((userId) => ({ userId }));
  try {
    await createExpense(db, personId, groupId, {
      description: row.description,
      amountCents: row.amountCents,
      payerId: row.payerId,
      splitMethod: 'EQUAL',
      ...(row.category ? { category: row.category } : {}),
      participants,
      date: calendarDate(on),
    });
  } catch (err) {
    // A member who left between the rule being written and the bill coming due is the common case, and
    // it should read as a fixable problem with the rule rather than a server fault.
    if (err instanceof ExpenseError) throw new RecurringRuleError('INVALID_PARTICIPANT', err.message);
    throw err;
  }

  return advance(db, groupId, ruleId, on, today);
}

/** Mark an occurrence dealt with without adding anything. The month you paid it yourself. */
export async function skipOccurrence(
  db: DB,
  personId: string,
  groupId: string,
  ruleId: string,
  on: string,
  today: string,
): Promise<RecurringRuleView> {
  await requireMembership(db, personId, groupId);
  const row = await loadActive(db, groupId, ruleId);
  const due = dueOccurrences(
    { cadence: row.cadence as Cadence, startsOn: row.startsOn, lastHandledOn: row.lastHandledOn },
    today,
  );
  if (!row.active || !due.dates.includes(on)) {
    throw new RecurringRuleError('INVALID_DATE', 'That one is not due.');
  }
  return advance(db, groupId, ruleId, on, today);
}

/**
 * Move the handled marker forward, never back.
 *
 * Accepting an older proposal while a newer one is also outstanding must not rewind the marker and
 * re-open occurrences already dealt with, which is what a plain assignment would do.
 */
async function advance(
  db: DB,
  groupId: string,
  ruleId: string,
  on: string,
  today: string,
): Promise<RecurringRuleView> {
  const row = await loadActive(db, groupId, ruleId);
  const next = !row.lastHandledOn || on > row.lastHandledOn ? on : row.lastHandledOn;
  await db.update(recurringRules).set({ lastHandledOn: next }).where(eq(recurringRules.id, ruleId));
  const updated = await loadActive(db, groupId, ruleId);
  return toView(updated, today);
}

/** Stop a rule without erasing it, so the expenses it made keep their explanation. */
export async function setRecurringActive(
  db: DB,
  personId: string,
  groupId: string,
  ruleId: string,
  active: boolean,
  today: string,
): Promise<RecurringRuleView> {
  await requireMembership(db, personId, groupId);
  await loadActive(db, groupId, ruleId);
  await db.update(recurringRules).set({ active }).where(eq(recurringRules.id, ruleId));
  const updated = await loadActive(db, groupId, ruleId);
  return toView(updated, today);
}
