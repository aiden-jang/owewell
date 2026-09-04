import { Hono } from 'hono';
import { SettleError } from '@owewell/shared';
import { z } from 'zod';
import { resolveSession } from '@aidenjang/auth-client';
import { harden } from './harden.js';
import { looksLikeShareToken } from './shareToken.js';
import { perIp } from './rateLimit.js';
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
  revokeShareToken,
  rotateShareToken,
  getSharedSummary,
  listGroups,
  renameGroup,
  requireMembership,
  setGroupArchived,
} from './groups.js';
import { addPlaceholderMember, removeMember, renameMember, setPaymentHandles } from './members.js';
import {
  ExpenseError,
  createExpense,
  deleteExpense,
  getBalances,
  restoreExpense,
  updateExpense,
} from './expenses.js';
import { createItemizedExpense, updateItemizedExpense } from './itemizedExpenses.js';
import { listExpenses } from './expenseList.js';
import { EXPENSE_CATEGORY_KEYS, PAYMENT_METHODS } from '@owewell/core';
import {
  SettlementError,
  deleteSettlement,
  getSuggestedPayments,
  listSettlements,
  recordSettlement,
} from './settlements.js';
import { QuickSplitError, createQuickSplit } from './quicksplit.js';
import { notifyGroupChanged } from './realtime.js';

type Vars = { person: Person };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// Every API route hangs off this, mounted below at both prefixes.
const api = new Hono<{ Bindings: Env; Variables: Vars }>();

// Security headers on every response + a same-origin CSRF guard on state-changing requests.
// The GET WebSocket upgrade for realtime is a safe method, so it passes through untouched.
app.use('*', harden());

/**
 * Nothing this API returns is cacheable.
 *
 * A GET with no directives is heuristically cacheable, so the browser may keep it. In accounts that
 * showed up as: sign out, press back, the session re-check is answered from cache, and you appear
 * signed in. It cuts both ways — a cached `{user: null}` tells a signed-in person they are not.
 *
 * Applied to every API path, not just /me: every response here depends on who is asking, and a
 * response like that must never be stored.
 */
api.use('*', noStore());
app.use('/health', noStore());

// Per-IP ceiling across the whole API, registered BEFORE the auth guard on purpose: every
// authenticated request costs a round trip to the shared auth service, so a flood here is
// amplified into a flood there. Set far above real use — opening the app and clicking through
// a few groups is a couple of dozen requests — so it only ever catches a script.
// /health is deliberately outside this, or an uptime monitor could trip it.
api.use(
  '*',
  perIp((env) => env.API_LIMITER, 'Slow down a moment, then try again.'),
);

function noStore() {
  return async (c: { header: (k: string, v: string) => void }, next: () => Promise<void>) => {
    await next();
    c.header('Cache-Control', 'no-store, max-age=0');
    c.header('Pragma', 'no-cache');
  };
}

/**
 * Static assets, which are the opposite case: a blanket `no-store` here re-downloads the hashed
 * bundles on every navigation, because `run_worker_first` sends the whole origin through us.
 *
 * Two buckets. Content-addressed files (Vite's hashed bundles, versioned font subsets) can never
 * change under a given name, so a year and `immutable`. Everything else — index.html, the service
 * worker, the manifest, icons — keeps its name across deploys and must revalidate, or a released
 * fix sits behind a stale shell.
 */
const IMMUTABLE = /^\/(assets\/|fonts\/)/;

const isApiPath = (path: string) => path.startsWith('/api') || path.startsWith('/owewell');

app.use('*', async (c, next) => {
  await next();
  // Both API prefixes, or this overwrites the no-store that noStore() just set and makes
  // per-user responses cacheable again.
  if (isApiPath(c.req.path) || c.req.path === '/health') return;
  c.header('Cache-Control', IMMUTABLE.test(c.req.path) ? 'public, max-age=31536000, immutable' : 'no-cache');
});

app.get('/health', (c) => c.json({ status: 'ok', service: 'owewell' }));

// Who is the caller? Same-origin endpoint the web app polls so the browser never has to
// talk to the auth service cross-origin. Returns { user: null } when signed out (not 401),
// since owewell is usable signed-out (quick split). Registered before the auth guard below.
api.get('/me', async (c) => {
  // An unreachable auth service reads as signed out here on purpose: owewell works signed-out,
  // so the anonymous app is the honest degraded state. The guard below makes the other call.
  const session = await resolveSession(c.req.raw, c.env.AUTH_URL);
  if (session.state !== 'signed-in') return c.json({ user: null });
  const user = session.user;
  const person = await getOrCreatePerson(createDb(c.env), user);
  return c.json({
    user: { id: user.id, email: user.email, displayName: user.displayName },
    personId: person.id,
  });
});

// Public, read-only group summary for a share link. No auth by design: anyone with the token
// may view (never edit). Registered before the auth guard below. 404 for an unknown token.
//
// The only unauthenticated endpoint, so the only one anyone would bother guessing at. Two
// guards, in cheapest-first order:
//   1. Reject anything that isn't shaped like a token, before touching the database. A guesser
//      should not get a free D1 query per attempt.
//   2. A tighter per-IP limit than the rest of the API (see the middleware above this route).
//      This is what allows the token to be short: without it the token's length is the entire
//      defence.
api.get(
  '/shared/:token',
  perIp((env) => env.SHARE_LIMITER, 'Too many attempts. Try again shortly.'),
  async (c) => {
    const token = c.req.param('token');
    if (!looksLikeShareToken(token)) return c.json({ error: 'NOT_FOUND' }, 404);

    const summary = await getSharedSummary(createDb(c.env), token);
    if (!summary) return c.json({ error: 'NOT_FOUND' }, 404);
    return c.json({ summary });
  },
);

// Everything else under /owewell requires a signed-in user (validated against the shared
// auth service), resolved to this app's local person.
api.use('*', async (c, next) => {
  const session = await resolveSession(c.req.raw, c.env.AUTH_URL);
  // 503, not 401. A 401 tells a signed-in caller they are signed out, and the web app answers
  // that by clearing the user it holds, so an auth hiccup logs people out of their own groups.
  if (session.state === 'unavailable') {
    return c.json({ error: 'AUTH_UNAVAILABLE' }, 503, { 'Retry-After': '30' });
  }
  if (session.state === 'signed-out') return c.json({ error: 'UNAUTHENTICATED' }, 401);
  c.set('person', await getOrCreatePerson(createDb(c.env), session.user));
  await next();
});

api.post('/groups', async (c) => {
  const parsed = z
    .object({ name: z.string().trim().min(1).max(80) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const group = await createGroup(createDb(c.env), c.get('person').id, parsed.data.name);
  return c.json({ group }, 201);
});

api.get('/groups', async (c) => {
  return c.json({ groups: await listGroups(createDb(c.env), c.get('person').id) });
});

api.get('/groups/:id', async (c) => {
  return c.json({ group: await getGroup(createDb(c.env), c.get('person').id, c.req.param('id')) });
});

api.patch('/groups/:id', async (c) => {
  const parsed = z
    .object({ name: z.string().trim().min(1).max(80) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const group = await renameGroup(createDb(c.env), c.get('person').id, c.req.param('id'), parsed.data.name);
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ group });
});

api.post('/groups/:id/archive', async (c) => {
  const parsed = z.object({ archived: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const group = await setGroupArchived(
    createDb(c.env),
    c.get('person').id,
    c.req.param('id'),
    parsed.data.archived,
  );
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ group });
});

api.delete('/groups/:id', async (c) => {
  await deleteGroup(createDb(c.env), c.get('person').id, c.req.param('id'));
  return c.json({ ok: true });
});

// Create (or fetch) the group's public read-only share token. Members only.
api.post('/groups/:id/share', async (c) => {
  const token = await getOrCreateShareToken(createDb(c.env), c.get('person').id, c.req.param('id'));
  return c.json({ token });
});

// Mint a replacement, killing every copy of the old link. Owner-only.
api.post('/groups/:id/share/rotate', async (c) => {
  const token = await rotateShareToken(createDb(c.env), c.get('person').id, c.req.param('id'));
  return c.json({ token });
});

// Remove the public view entirely. Owner-only.
api.delete('/groups/:id/share', async (c) => {
  await revokeShareToken(createDb(c.env), c.get('person').id, c.req.param('id'));
  return c.json({ ok: true });
});

// Add a member: a name-only placeholder seat. Real people join by claiming their seat via the
// group's share link (see /owewell/shared/:token/claim); there's no separate invite flow.
const addMemberBody = z.object({ name: z.string().trim().min(1).max(80) });
api.post('/groups/:id/members', async (c) => {
  const parsed = addMemberBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const member = await addPlaceholderMember(
    createDb(c.env),
    c.get('person').id,
    c.req.param('id'),
    parsed.data.name,
  );
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ member }, 201);
});

api.patch('/groups/:id/members/:personId', async (c) => {
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

api.patch('/groups/:id/members/:personId/payment', async (c) => {
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

api.delete('/groups/:id/members/:personId', async (c) => {
  await removeMember(createDb(c.env), c.get('person').id, c.req.param('id'), c.req.param('personId'));
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ ok: true });
});

api.get('/groups/:id/balances', async (c) => {
  return c.json({ balances: await getBalances(createDb(c.env), c.get('person').id, c.req.param('id')) });
});

api.get('/groups/:id/expenses', async (c) => {
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
api.post('/groups/:id/expenses', async (c) => {
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
api.post('/groups/:id/expenses/itemized', async (c) => {
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

api.put('/groups/:id/expenses/:expenseId', async (c) => {
  const parsed = createExpenseBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const { date, participants, ...rest } = parsed.data;
  const expense = await updateExpense(
    createDb(c.env),
    c.get('person').id,
    c.req.param('id'),
    c.req.param('expenseId'),
    {
      ...rest,
      participants: participants.map((p) =>
        p.value === undefined ? { userId: p.userId } : { userId: p.userId, value: p.value },
      ),
      ...(date ? { date: new Date(date) } : {}),
    },
  );
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ expense });
});

api.put('/groups/:id/expenses/:expenseId/itemized', async (c) => {
  const parsed = itemizedBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const { date, ...rest } = parsed.data;
  const expense = await updateItemizedExpense(
    createDb(c.env),
    c.get('person').id,
    c.req.param('id'),
    c.req.param('expenseId'),
    {
      ...rest,
      ...(date ? { date: new Date(date) } : {}),
    },
  );
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ expense });
});

api.post('/groups/:id/expenses/:expenseId/restore', async (c) => {
  const expense = await restoreExpense(
    createDb(c.env),
    c.get('person').id,
    c.req.param('id'),
    c.req.param('expenseId'),
  );
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ expense });
});

api.delete('/groups/:id/expenses/:expenseId', async (c) => {
  await deleteExpense(createDb(c.env), c.get('person').id, c.req.param('id'), c.req.param('expenseId'));
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ ok: true });
});

api.get('/groups/:id/settlements', async (c) => {
  return c.json({
    settlements: await listSettlements(createDb(c.env), c.get('person').id, c.req.param('id')),
  });
});

api.get('/groups/:id/settlements/suggested', async (c) => {
  return c.json({
    suggested: await getSuggestedPayments(createDb(c.env), c.get('person').id, c.req.param('id')),
  });
});

const recordSettlementBody = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  amountCents: z.number().int().positive(),
  method: z.enum(PAYMENT_METHODS).optional(),
  clientId: z.string().min(8).max(64).optional(),
});
api.post('/groups/:id/settlements', async (c) => {
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

api.delete('/groups/:id/settlements/:settlementId', async (c) => {
  await deleteSettlement(createDb(c.env), c.get('person').id, c.req.param('id'), c.req.param('settlementId'));
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ ok: true });
});

// Claim an unclaimed seat (placeholder) via a share token. Requires sign-in (auth guard above);
// the token authorizes the claim. The caller merges into the placeholder and becomes a member.
api.post('/shared/:token/claim', async (c) => {
  const parsed = z.object({ personId: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
  const result = await claimPlaceholder(
    createDb(c.env),
    c.get('person').id,
    c.req.param('token'),
    parsed.data.personId,
  );
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
api.post('/quick-splits', async (c) => {
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
api.get('/groups/:id/ws', async (c) => {
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
// The API lives at /api. `/owewell` is the old prefix, kept working because a browser holding a
// cached service worker or an old bundle is still calling it. Both point at the same routes, so
// there is nothing to keep in step. Safe to delete once no client is on the old bundle.
app.route('/api', api);
app.route('/owewell', api);

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export { GroupRoom } from './realtime.js';
export default app;
