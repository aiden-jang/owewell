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
