import { Hono } from 'hono';
import { SettleError } from '@owewell/shared';
import { z } from 'zod';
import { getSessionUser } from '@aidenjang/auth-client';
import { harden } from './harden.js';
import type { Env } from './env.js';
import { createDb } from './db/client.js';
import { getOrCreatePerson, type Person } from './people.js';
import {
  GroupError,
  addPlaceholderMember,
  claimPlaceholder,
  createGroup,
  deleteGroup,
  getGroup,
  getOrCreateShareToken,
  getSharedSummary,
  listGroups,
  removeMember,
  renameGroup,
  setGroupBudget,
  setGroupCurrency,
  setSettlementDeadline,
  renameMember,
  requireMembership,
  setGroupArchived,
  setPaymentHandles,
} from './groups.js';
import {
  ExpenseError,
  createExpense,
  createItemizedExpense,
  deleteExpense,
  getBalances,
  listExpenses,
  updateExpense,
  updateItemizedExpense,
} from './expenses.js';
import { EXPENSE_CATEGORY_KEYS, PAYMENT_METHODS } from '@owewell/core';
import {
  SettlementError,
  deleteSettlement,
  getSuggestedPayments,
  listSettlements,
  recordSettlement,
} from './settlements.js';
import { extractReceipt } from './ocr.js';
import { QuickSplitError, createQuickSplit } from './quicksplit.js';
import { notifyGroupChanged } from './realtime.js';

type Vars = { person: Person };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// Security headers on every response + a same-origin CSRF guard on state-changing requests.
// The GET WebSocket upgrade for realtime is a safe method, so it passes through untouched.
app.use('*', harden());

/**
 * Nothing this API returns is cacheable.
 *
 * /owewell/me had no Cache-Control, and a GET with no directives is heuristically cacheable, so the
 * browser is free to keep it. The same bug in accounts produced a visible one: sign out, press back,
 * the page re-checks the session, the browser answers from its own cache, and you appear signed in
 * until a refresh. Here it cuts both ways, because a cached `{user: null}` can just as easily keep
 * telling a freshly signed-in person they are signed out.
 *
 * Applied to everything rather than to /me, because every response here is per-user: balances, groups,
 * expenses. A response whose body depends on who is asking must never be stored.
 */
app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store, max-age=0');
  c.header('Pragma', 'no-cache');
});

app.get('/health', (c) => c.json({ status: 'ok', service: 'owewell' }));

// Who is the caller? Same-origin endpoint the web app polls so the browser never has to
// talk to the auth service cross-origin. Returns { user: null } when signed out (not 401),
// since owewell is usable signed-out (quick split). Registered before the auth guard below.
app.get('/owewell/me', async (c) => {
  const user = await getSessionUser(c.req.raw, c.env.AUTH_URL);
  if (!user) return c.json({ user: null });
  const person = await getOrCreatePerson(createDb(c.env), user);
  return c.json({
    user: { id: user.id, email: user.email, displayName: user.displayName },
    personId: person.id,
  });
});

// Public, read-only group summary for a share link. No auth by design: anyone with the token
// may view (never edit). Registered before the auth guard below. 404 for an unknown token.
app.get('/owewell/shared/:token', async (c) => {
  const summary = await getSharedSummary(createDb(c.env), c.req.param('token'));
  if (!summary) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json({ summary });
});

// Everything else under /owewell requires a signed-in user (validated against the shared
// auth service), resolved to this app's local person.
app.use('/owewell/*', async (c, next) => {
  const user = await getSessionUser(c.req.raw, c.env.AUTH_URL);
  if (!user) return c.json({ error: 'UNAUTHENTICATED' }, 401);
  c.set('person', await getOrCreatePerson(createDb(c.env), user));
  await next();
});

app.post('/owewell/groups', async (c) => {
  const parsed = z
    .object({ name: z.string().trim().min(1).max(80), currency: z.string().min(3).max(3).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const group = await createGroup(createDb(c.env), c.get('person').id, parsed.data.name, parsed.data.currency);
  return c.json({ group }, 201);
});

app.get('/owewell/groups', async (c) => {
  return c.json({ groups: await listGroups(createDb(c.env), c.get('person').id) });
});

app.get('/owewell/groups/:id', async (c) => {
  return c.json({ group: await getGroup(createDb(c.env), c.get('person').id, c.req.param('id')) });
});

app.patch('/owewell/groups/:id', async (c) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const group = await renameGroup(createDb(c.env), c.get('person').id, c.req.param('id'), parsed.data.name);
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ group });
});

app.patch('/owewell/groups/:id/settle-by', async (c) => {
  const parsed = z.object({ settleBy: z.string().datetime({ offset: true }).nullable() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const date = parsed.data.settleBy ? new Date(parsed.data.settleBy) : null;
  if (date && date.getTime() < Date.now() - 60_000) {
    return c.json({ error: 'ValidationError', message: 'Choose a settle-by time that has not passed.' }, 400);
  }
  const group = await setSettlementDeadline(createDb(c.env), c.get('person').id, c.req.param('id'), date);
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ group });
});

/*
 * One shared spending target for the group. Owner-only, like the settle-by deadline.
 *
 * Takes cents rather than a decimal string, matching every other money field on this API: a float that
 * has been through JSON is not a reliable way to say $19.99.
 */
app.patch('/owewell/groups/:id/budget', async (c) => {
  const parsed = z
    .object({ budgetCents: z.number().int().positive().nullable() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const group = await setGroupBudget(createDb(c.env), c.get('person').id, c.req.param('id'), parsed.data.budgetCents);
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ group });
});

app.patch('/owewell/groups/:id/currency', async (c) => {
  const parsed = z.object({ currency: z.string().min(3).max(3) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const group = await setGroupCurrency(createDb(c.env), c.get('person').id, c.req.param('id'), parsed.data.currency);
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ group });
});

app.post('/owewell/groups/:id/archive', async (c) => {
  const parsed = z.object({ archived: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const group = await setGroupArchived(createDb(c.env), c.get('person').id, c.req.param('id'), parsed.data.archived);
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ group });
});

app.delete('/owewell/groups/:id', async (c) => {
  await deleteGroup(createDb(c.env), c.get('person').id, c.req.param('id'));
  return c.json({ ok: true });
});

// Create (or fetch) the group's public read-only share token. Members only.
app.post('/owewell/groups/:id/share', async (c) => {
  const token = await getOrCreateShareToken(createDb(c.env), c.get('person').id, c.req.param('id'));
  return c.json({ token });
});

// Add a member: a name-only placeholder seat. Real people join by claiming their seat via the
// group's share link (see /owewell/shared/:token/claim); there's no separate invite flow.
const addMemberBody = z.object({ name: z.string().trim().min(1).max(80) });
app.post('/owewell/groups/:id/members', async (c) => {
  const parsed = addMemberBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const member = await addPlaceholderMember(createDb(c.env), c.get('person').id, c.req.param('id'), parsed.data.name);
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ member }, 201);
});

app.patch('/owewell/groups/:id/members/:personId', async (c) => {
  const parsed = z
    .object({ name: z.string().trim().min(1).max(80) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const member = await renameMember(
    createDb(c.env),
    c.get('person').id,
    c.req.param('id'),
    c.req.param('personId'),
    parsed.data.name,
  );
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ member });
});

app.patch('/owewell/groups/:id/members/:personId/payment', async (c) => {
  const handle = z.string().trim().max(64).optional();
  const parsed = z
    .object({ venmoHandle: handle, cashappCashtag: handle, paypalHandle: handle })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const member = await setPaymentHandles(
    createDb(c.env),
    c.get('person').id,
    c.req.param('id'),
    c.req.param('personId'),
    parsed.data,
  );
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ member });
});

app.delete('/owewell/groups/:id/members/:personId', async (c) => {
  await removeMember(createDb(c.env), c.get('person').id, c.req.param('id'), c.req.param('personId'));
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ ok: true });
});

app.get('/owewell/groups/:id/balances', async (c) => {
  return c.json({ balances: await getBalances(createDb(c.env), c.get('person').id, c.req.param('id')) });
});

app.get('/owewell/groups/:id/expenses', async (c) => {
  return c.json({ expenses: await listExpenses(createDb(c.env), c.get('person').id, c.req.param('id')) });
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const category = z.enum(EXPENSE_CATEGORY_KEYS as [string, ...string[]]).optional();
const createExpenseBody = z.object({
  description: z.string().trim().min(1).max(140),
  amountCents: z.number().int().positive(),
  payerId: z.string().min(1),
  splitMethod: z.enum(['EQUAL', 'EXACT', 'PERCENT', 'SHARES']),
  participants: z.array(z.object({ userId: z.string().min(1), value: z.number().int().optional() })).min(1),
  category,
  date: isoDate.optional(),
});
app.post('/owewell/groups/:id/expenses', async (c) => {
  const parsed = createExpenseBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const { date, participants, ...rest } = parsed.data;
  const expense = await createExpense(createDb(c.env), c.get('person').id, c.req.param('id'), {
    ...rest,
    participants: participants.map((p) =>
      p.value === undefined ? { userId: p.userId } : { userId: p.userId, value: p.value },
    ),
    ...(date ? { date: new Date(date) } : {}),
  });
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ expense }, 201);
});

const itemizedBody = z.object({
  description: z.string().trim().min(1).max(140),
  payerId: z.string().min(1),
  taxCents: z.number().int().nonnegative().default(0),
  tipCents: z.number().int().nonnegative().default(0),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(140),
        amountCents: z.number().int().positive(),
        participantIds: z.array(z.string().min(1)).min(1),
        payerId: z.string().min(1).optional(),
      }),
    )
    .min(1),
  category,
  date: isoDate.optional(),
});
app.post('/owewell/groups/:id/expenses/itemized', async (c) => {
  const parsed = itemizedBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const { date, ...rest } = parsed.data;
  const expense = await createItemizedExpense(createDb(c.env), c.get('person').id, c.req.param('id'), {
    ...rest,
    ...(date ? { date: new Date(date) } : {}),
  });
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ expense }, 201);
});

app.put('/owewell/groups/:id/expenses/:expenseId', async (c) => {
  const parsed = createExpenseBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const { date, participants, ...rest } = parsed.data;
  const expense = await updateExpense(createDb(c.env), c.get('person').id, c.req.param('id'), c.req.param('expenseId'), {
    ...rest,
    participants: participants.map((p) =>
      p.value === undefined ? { userId: p.userId } : { userId: p.userId, value: p.value },
    ),
    ...(date ? { date: new Date(date) } : {}),
  });
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ expense });
});

app.put('/owewell/groups/:id/expenses/:expenseId/itemized', async (c) => {
  const parsed = itemizedBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const { date, ...rest } = parsed.data;
  const expense = await updateItemizedExpense(createDb(c.env), c.get('person').id, c.req.param('id'), c.req.param('expenseId'), {
    ...rest,
    ...(date ? { date: new Date(date) } : {}),
  });
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ expense });
});

app.delete('/owewell/groups/:id/expenses/:expenseId', async (c) => {
  await deleteExpense(createDb(c.env), c.get('person').id, c.req.param('id'), c.req.param('expenseId'));
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ ok: true });
});

app.get('/owewell/groups/:id/settlements', async (c) => {
  return c.json({ settlements: await listSettlements(createDb(c.env), c.get('person').id, c.req.param('id')) });
});

app.get('/owewell/groups/:id/settlements/suggested', async (c) => {
  return c.json({ suggested: await getSuggestedPayments(createDb(c.env), c.get('person').id, c.req.param('id')) });
});

const recordSettlementBody = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  amountCents: z.number().int().positive(),
  method: z.enum(PAYMENT_METHODS).optional(),
});
app.post('/owewell/groups/:id/settlements', async (c) => {
  const parsed = recordSettlementBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const settlement = await recordSettlement(createDb(c.env), c.get('person').id, c.req.param('id'), {
    fromUserId: parsed.data.fromUserId,
    toUserId: parsed.data.toUserId,
    amountCents: parsed.data.amountCents,
    ...(parsed.data.method ? { method: parsed.data.method } : {}),
  });
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ settlement }, 201);
});

app.delete('/owewell/groups/:id/settlements/:settlementId', async (c) => {
  await deleteSettlement(createDb(c.env), c.get('person').id, c.req.param('id'), c.req.param('settlementId'));
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ ok: true });
});

app.post('/owewell/groups/:id/ocr', async (c) => {
  await requireMembership(createDb(c.env), c.get('person').id, c.req.param('id'));
  const form = await c.req.formData();
  const file = form.get('file') as File | string | null;
  if (!file || typeof file === 'string') return c.json({ error: 'NoFile', message: 'Attach a receipt image.' }, 400);
  try {
    const receipt = await extractReceipt(c.env, await file.arrayBuffer(), file.type);
    return c.json({ receipt });
  } catch (err) {
    console.error('receipt OCR failed', err);
    return c.json({ error: 'OcrFailed', message: 'Could not read that receipt.' }, 502);
  }
});

// Claim an unclaimed seat (placeholder) via a share token. Requires sign-in (auth guard above);
// the token authorizes the claim. The caller merges into the placeholder and becomes a member.
app.post('/owewell/shared/:token/claim', async (c) => {
  const parsed = z.object({ personId: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const result = await claimPlaceholder(createDb(c.env), c.get('person').id, c.req.param('token'), parsed.data.personId);
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, result.groupId));
  return c.json(result);
});

const quickSplitBody = z.object({
  people: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        isPayer: z.boolean().optional(),
        isYou: z.boolean().optional(),
      }),
    )
    .min(2)
    .max(50),
  items: z
    .array(
      z.object({
        description: z.string().trim().max(140).default(''),
        amountCents: z.number().int().positive(),
        splitMethod: z.enum(['EQUAL', 'EXACT', 'PERCENT', 'SHARES']),
        // Per-person values aligned to `people`; null for EQUAL / no value.
        values: z.array(z.number().int().nullable()).optional(),
        // Index into `people` of who paid for this item; omitted → default payer.
        payerIndex: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(50),
});
app.post('/owewell/quick-splits', async (c) => {
  const parsed = quickSplitBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const result = await createQuickSplit(createDb(c.env), c.get('person').id, {
    people: parsed.data.people.map((p) => ({
      name: p.name,
      isPayer: Boolean(p.isPayer),
      isYou: Boolean(p.isYou),
    })),
    items: parsed.data.items.map((it) => ({
      description: it.description,
      amountCents: it.amountCents,
      splitMethod: it.splitMethod,
      ...(it.values === undefined ? {} : { values: it.values }),
      ...(it.payerIndex === undefined ? {} : { payerIndex: it.payerIndex }),
    })),
  });
  return c.json(result, 201);
});

// Live updates: authenticated members upgrade to a WebSocket bound to this group's room.
// Auth + membership are checked here; the Durable Object only ever sees authorized sockets.
app.get('/owewell/groups/:id/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.json({ error: 'ExpectedWebSocket' }, 426);
  const groupId = c.req.param('id');
  await requireMembership(createDb(c.env), c.get('person').id, groupId);
  const url = new URL(c.req.url);
  url.searchParams.set('groupId', groupId);
  const stub = c.env.REALTIME.get(c.env.REALTIME.idFromName(groupId));
  return stub.fetch(new Request(url.toString(), c.req.raw));
});

app.onError((err, c) => {
  if (err instanceof GroupError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'NOT_OWNER' || err.code === 'CANNOT_REMOVE_OWNER'
          ? 403
          : // A rejected value is not a conflict with anything, and 409 sends the client looking for a
            // race that never happened.
            err.code === 'INVALID_BUDGET' || err.code === 'INVALID_CURRENCY'
            ? 422
            : 409;
    return c.json({ error: err.code, message: err.message }, status);
  }
  if (err instanceof ExpenseError) {
    return c.json({ error: err.code, message: err.message }, err.code === 'NOT_FOUND' ? 404 : 422);
  }
  if (err instanceof SettlementError) {
    return c.json({ error: err.code, message: err.message }, err.code === 'NOT_FOUND' ? 404 : 422);
  }
  if (err instanceof QuickSplitError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  // A broken ledger invariant. Still a 500 (the data is wrong, not the request), but it carries the
  // message: reporting this as a bare INTERNAL is what turned a one-line diagnosis into an afternoon.
  if (err instanceof SettleError) {
    console.error('owewell ledger invariant broken', err);
    return c.json({ error: 'LEDGER_INVARIANT', message: err.message }, 500);
  }
  console.error('owewell api error', err);
  return c.json({ error: 'INTERNAL' }, 500);
});

// Everything that isn't the API (/health, /owewell/*) is the web SPA: real files, or the
// index.html fallback for client routes. run_worker_first routes it all through here.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export { GroupRoom } from './realtime.js';
export default app;
