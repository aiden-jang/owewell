import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// owewell-local identity. Real accounts link via authUserId (from the shared auth service);
// placeholders (name-only people added to a group, no login) have authUserId = null.
// owewell never foreign-keys into the auth service's DB; it references people.id.
export const people = sqliteTable('people', {
  id: text('id').primaryKey(),
  authUserId: text('auth_user_id').unique(),
  displayName: text('display_name').notNull(),
  isPlaceholder: integer('is_placeholder', { mode: 'boolean' }).notNull().default(false),
  // Optional payment handles, used to build "settle up via Venmo/Cash App/PayPal" deep links.
  // Stored without the leading @ / $ so links can be composed uniformly.
  venmoHandle: text('venmo_handle'),
  cashappCashtag: text('cashapp_cashtag'),
  paypalHandle: text('paypal_handle'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdById: text('created_by_id')
    .notNull()
    .references(() => people.id),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  // Unguessable token for the public, read-only share page. Null until a member creates a link.
  shareToken: text('share_token').unique(),
  // Optional owner-set deadline for the current settle-up plan. Shared by every group member.
  settleBy: integer('settle_by', { mode: 'timestamp' }),
  // Optional owner-set spending target for the whole group, in cents. Null means the group never set
  // one, which is most groups: a budget is a trip thing, not a flatshare thing.
  budgetCents: integer('budget_cents'),
});

export const groupMembers = sqliteTable(
  'group_members',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('MEMBER'), // OWNER | MEMBER
    joinedAt: integer('joined_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    // Per-member "hide from my list". Null = active in this member's view. Personal, not global.
    archivedAt: integer('archived_at', { mode: 'timestamp' }),
  },
  (t) => ({
    groupPerson: uniqueIndex('gm_group_person').on(t.groupId, t.personId),
    byPerson: index('gm_person').on(t.personId),
  }),
);

export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    payerId: text('payer_id')
      .notNull()
      .references(() => people.id),
    createdById: text('created_by_id')
      .notNull()
      .references(() => people.id),
    description: text('description').notNull(),
    // Always integer cents. amountCents is the grand total (items + tax + tip for ITEMIZED).
    amountCents: integer('amount_cents').notNull(),
    splitMethod: text('split_method').notNull(), // EQUAL | EXACT | PERCENT | SHARES | ITEMIZED
    // Spend category key (see @owewell/core EXPENSE_CATEGORIES). Null on legacy rows = "other".
    category: text('category'),
    taxCents: integer('tax_cents').notNull().default(0),
    tipCents: integer('tip_cents').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    // The date the expense actually happened (backdatable). Null = use createdAt.
    date: integer('date', { mode: 'timestamp' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp' }), // soft delete; keeps balances auditable
  },
  (t) => ({ byGroup: index('exp_group').on(t.groupId) }),
);

/* What an expense used to say. Editing overwrote in place, so a $40 dinner becoming $80 left no
 * evidence but a moved balance. Corrections stay easy; they stop being invisible. */
export const expenseRevisions = sqliteTable(
  'expense_revisions',
  {
    id: text('id').primaryKey(),
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    editedById: text('edited_by_id')
      .notNull()
      .references(() => people.id),
    // Milliseconds, set explicitly: at seconds resolution two edits in the same second tie, and
    // "the latest correction" becomes whatever order the rows come back in.
    editedAt: integer('edited_at', { mode: 'timestamp_ms' }).notNull(),
    // The values before this edit, so "what was it?" is answerable without replaying every row.
    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    payerId: text('payer_id').notNull(),
    splitMethod: text('split_method').notNull(),
    /** Which of them actually moved, as a comma-separated list. Saves diffing rows to find out. */
    fields: text('fields').notNull(),
  },
  (t) => ({ byExpense: index('rev_expense').on(t.expenseId) }),
);

export const expenseSplits = sqliteTable(
  'expense_splits',
  {
    id: text('id').primaryKey(),
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    owedCents: integer('owed_cents').notNull(),
    // Raw input that produced owedCents (EXACT: cents, PERCENT: basis points, SHARES: weight; null for EQUAL).
    inputValue: integer('input_value'),
  },
  (t) => ({ expensePerson: uniqueIndex('es_expense_person').on(t.expenseId, t.personId) }),
);

export const expenseItems = sqliteTable('expense_items', {
  id: text('id').primaryKey(),
  expenseId: text('expense_id')
    .notNull()
    .references(() => expenses.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  amountCents: integer('amount_cents').notNull(),
  // Who paid for this line item. Null means "the expense's payer" — covers rows
  // created before per-item payers existed, and items where no payer was picked.
  payerId: text('payer_id').references(() => people.id),
});

export const expenseItemShares = sqliteTable(
  'expense_item_shares',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => expenseItems.id, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
  },
  (t) => ({ itemPerson: uniqueIndex('eis_item_person').on(t.itemId, t.personId) }),
);

export const settlements = sqliteTable(
  'settlements',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    fromPersonId: text('from_person_id')
      .notNull()
      .references(() => people.id),
    toPersonId: text('to_person_id')
      .notNull()
      .references(() => people.id),
    amountCents: integer('amount_cents').notNull(),
    // Optional payment-method tag: venmo | paypal | zelle | cash | other (surfaced in the feed).
    method: text('method'),
    createdById: text('created_by_id')
      .notNull()
      .references(() => people.id),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({ byGroup: index('settle_group').on(t.groupId) }),
);

/*
 * A template plus a schedule, never a ledger entry: nothing here moves a balance until somebody accepts
 * a proposal. Dates are plain YYYY-MM-DD, since "the 1st" stored as an instant is the 30th west of you.
 */
export const recurringRules = sqliteTable('recurring_rules', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  createdById: text('created_by_id')
    .notNull()
    .references(() => people.id),
  description: text('description').notNull(),
  amountCents: integer('amount_cents').notNull(),
  payerId: text('payer_id')
    .notNull()
    .references(() => people.id),
  category: text('category'),
  /** 'weekly' | 'monthly'. Validated in the app layer against @owewell/shared CADENCES. */
  cadence: text('cadence').notNull(),
  /** The anchor. Every later occurrence is measured from here, never from the previous one. */
  startsOn: text('starts_on').notNull(),
  /** Latest occurrence added OR skipped. Skipping must advance it or the proposal never goes away. */
  lastHandledOn: text('last_handled_on'),
  /* JSON array of person ids, always split evenly. An EXACT template would be misleading: the amount
   * that made those numbers right is the one thing about a bill that changes. Edit the expense instead. */
  participantIds: text('participant_ids').notNull(),
  /** Stopped rules are kept, not deleted, so the expenses they created keep their explanation. */
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});
