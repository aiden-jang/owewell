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
  claimPlaceholder,
  createGroup,
  deleteGroup,
  getGroup,
  getOrCreateShareToken,
  getSharedSummary,
  listGroups,
  renameGroup,
  requireMembership,
  setGroupArchived,
  setGroupBudget,
  setSettlementDeadline,
} from './groups.js';
import {
  addPlaceholderMember,
  removeMember,
  renameMember,
  setPaymentHandles,
} from './members.js';
import {
  ExpenseError,
  createExpense,
  createItemizedExpense,
  deleteExpense,
  getBalances,
  listExpenses,
  restoreExpense,
  updateExpense,
  updateItemizedExpense,
} from './expenses.js';
import { EXPENSE_CATEGORY_KEYS, PAYMENT_METHODS, scanRejection } from '@owewell/core';
import {
  SettlementError,
  deleteSettlement,
  getSuggestedPayments,
  listSettlements,
  recordSettlement,
} from './settlements.js';
import { extractReceipt } from './ocr.js';
import {
  deleteReceipt,
  deleteReceipts,
  getReceipt,
  putReceipt,
  ReceiptError,
} from './receipts.js';
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
 * Applied to every API path rather than to /me, because every one of them is per-user: balances,
 * groups, expenses. A response whose body depends on who is asking must never be stored.
 */
// Receipts set their own (private, short) caching: they are the one thing under /owewell that is
// bytes rather than a per-user answer, and re-fetching a photo on every render is pure waste.
const RECEIPT_PATH = /\/expenses\/[^/]+\/receipt$/;
app.use('/owewell/*', async (c, next) => {
  if (RECEIPT_PATH.test(c.req.path)) return next();
  return noStore()(c, next);
});
app.use('/health', noStore());

function noStore() {
  return async (c: { header: (k: string, v: string) => void }, next: () => Promise<void>) => {
    await next();
    c.header('Cache-Control', 'no-store, max-age=0');
    c.header('Pragma', 'no-cache');
  };
}

/**
 * Static assets, which are the opposite case.
 *
 * This used to be one `app.use('*')` that put `no-store` on literally every response, assets
 * included. Because `run_worker_first` sends the whole origin through this Worker, that meant the
 * hashed JS and CSS bundles were re-downloaded on every single navigation, and it would have made
 * self-hosting the font actively worse than loading it from Google.
 *
 * Two buckets. Content-addressed files (Vite's hashed bundles, the versioned font subsets) can never
 * change under a given name, so they get a year and `immutable`. Everything else — index.html, the
 * service worker, the manifest, icons — keeps its name across deploys, so it must revalidate or a
 * released fix sits behind a stale shell.
 */
const IMMUTABLE = /^\/(assets\/|fonts\/)/;

app.use('*', async (c, next) => {
  await next();
  if (c.req.path.startsWith('/owewell') || c.req.path === '/health') return;
  c.header(
    'Cache-Control',
    IMMUTABLE.test(c.req.path) ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
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
    .object({ name: z.string().trim().min(1).max(80) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const group = await createGroup(createDb(c.env), c.get('person').id, parsed.data.name);
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

app.post('/owewell/groups/:id/archive', async (c) => {
  const parsed = z.object({ archived: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const group = await setGroupArchived(createDb(c.env), c.get('person').id, c.req.param('id'), parsed.data.archived);
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ group });
});

app.delete('/owewell/groups/:id', async (c) => {
  const receiptKeys = await deleteGroup(createDb(c.env), c.get('person').id, c.req.param('id'));
  // After the rows are gone: an image nobody can reach is still an image being paid for. Skipped
  // entirely without a bucket, where by definition there is nothing stored to leave behind.
  const bucket = c.env.RECEIPTS;
  if (bucket) c.executionCtx.waitUntil(deleteReceipts(bucket, receiptKeys));
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
// A line of context, not a document. Empty string clears it, which is what an emptied field sends.
const note = z.string().trim().max(280).nullish();
const createExpenseBody = z.object({
  description: z.string().trim().min(1).max(140),
  amountCents: z.number().int().positive(),
  payerId: z.string().min(1),
  splitMethod: z.enum(['EQUAL', 'EXACT', 'PERCENT', 'SHARES']),
  participants: z.array(z.object({ userId: z.string().min(1), value: z.number().int().optional() })).min(1),
  category,
  note,
  // Opaque to us; the browser generates it. Bounded so it cannot be used as a smuggled payload.
  clientId: z.string().min(8).max(64).optional(),
  // Only meaningful on an edit: the version the change was written against.
  expectedVersion: z.number().int().positive().optional(),
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
  note,
  clientId: z.string().min(8).max(64).optional(),
  // Only meaningful on an edit: the version the change was written against.
  expectedVersion: z.number().int().positive().optional(),
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

app.post('/owewell/groups/:id/expenses/:expenseId/restore', async (c) => {
  const expense = await restoreExpense(
    createDb(c.env),
    c.get('person').id,
    c.req.param('id'),
    c.req.param('expenseId'),
  );
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
  clientId: z.string().min(8).max(64).optional(),
});
app.post('/owewell/groups/:id/settlements', async (c) => {
  const parsed = recordSettlementBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const settlement = await recordSettlement(createDb(c.env), c.get('person').id, c.req.param('id'), {
    fromUserId: parsed.data.fromUserId,
    toUserId: parsed.data.toUserId,
    amountCents: parsed.data.amountCents,
    ...(parsed.data.method ? { method: parsed.data.method } : {}),
    ...(parsed.data.clientId ? { clientId: parsed.data.clientId } : {}),
  });
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ settlement }, 201);
});

app.delete('/owewell/groups/:id/settlements/:settlementId', async (c) => {
  await deleteSettlement(createDb(c.env), c.get('person').id, c.req.param('id'), c.req.param('settlementId'));
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ ok: true });
});

/*
 * Receipt photos: written after the expense exists, read only by members.
 *
 * A separate request from the create rather than a multipart body on it, because the ledger write
 * has to be able to succeed on its own. A photo that fails to upload leaves an expense with the
 * money right and no picture, which is recoverable; a create that fails because an image did is not
 * worth the tidiness of one round trip.
 */
/*
 * Every receipt route goes through here first.
 *
 * With no bucket bound these endpoints cannot do their job, and saying so plainly beats the
 * alternatives: a 500 from a missing binding reads as a broken server, and letting the route 404
 * reads as a missing expense. The UI hides these controls anyway (VITE_RECEIPTS_ENABLED), so this
 * only answers a client that got here some other way.
 */
app.on(
  ['PUT', 'GET', 'DELETE'],
  '/owewell/groups/:id/expenses/:expenseId/receipt',
  async (c, next) => {
    if (!c.env.RECEIPTS) {
      return c.json({ error: 'RECEIPTS_DISABLED', message: 'Receipt photos are not enabled.' }, 503);
    }
    await next();
  },
);

app.put('/owewell/groups/:id/expenses/:expenseId/receipt', async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  await putReceipt(
    createDb(c.env),
    c.env.RECEIPTS!,
    c.get('person').id,
    c.req.param('id'),
    c.req.param('expenseId'),
    await c.req.arrayBuffer(),
    contentType.split(';')[0]?.trim() ?? '',
  );
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ ok: true });
});

app.get('/owewell/groups/:id/expenses/:expenseId/receipt', async (c) => {
  const object = await getReceipt(
    createDb(c.env),
    c.env.RECEIPTS!,
    c.get('person').id,
    c.req.param('id'),
    c.req.param('expenseId'),
  );
  if (!object) return c.json({ error: 'NOT_FOUND' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      // `private`, so it stays in the one browser that is allowed to have it and never in a shared
      // cache. Short, because replacing a photo keeps the same URL.
      'Cache-Control': 'private, max-age=300',
      // Belt and braces on a route that streams user-supplied bytes back out.
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

app.delete('/owewell/groups/:id/expenses/:expenseId/receipt', async (c) => {
  await deleteReceipt(
    createDb(c.env),
    c.env.RECEIPTS!,
    c.get('person').id,
    c.req.param('id'),
    c.req.param('expenseId'),
  );
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ ok: true });
});

app.post('/owewell/groups/:id/ocr', async (c) => {
  await requireMembership(createDb(c.env), c.get('person').id, c.req.param('id'));
  const form = await c.req.formData();
  const file = form.get('file') as File | string | null;
  if (!file || typeof file === 'string') return c.json({ error: 'NoFile', message: 'Attach a receipt image.' }, 400);
  /*
   * Checked here rather than only in the model call. Without it an unreadable image became a 502
   * "could not read that receipt", which reads as "your receipt is unclear" when the real answer is
   * "that file type will never work". Size too: base64 inflates by a third, and there was nothing
   * stopping a 40MB photo becoming a 53MB request.
   */
  const why = scanRejection(file);
  if (why) return c.json({ error: 'UnsupportedImage', message: why }, 400);
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
            err.code === 'INVALID_BUDGET'
            ? 422
            : 409;
    return c.json({ error: err.code, message: err.message }, status);
  }
  if (err instanceof ExpenseError) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'CONFLICT' ? 409 : 422;
    return c.json({ error: err.code, message: err.message }, status);
  }
  if (err instanceof SettlementError) {
    return c.json({ error: err.code, message: err.message }, err.code === 'NOT_FOUND' ? 404 : 422);
  }
  if (err instanceof ReceiptError) {
    return c.json({ error: err.code, message: err.message }, 422);
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
