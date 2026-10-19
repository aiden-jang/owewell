import { handleAnalytics } from '../../../analytics/worker.js';
import { handleApiError } from './apiErrors.js';
import { registerGroupRoutes } from './groupRoutes.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveSession } from '@aidenjang/auth-client';
import { harden } from './harden.js';
import { looksLikeShareToken } from './shareToken.js';
import { perIp } from './rateLimit.js';
import type { Env } from './env.js';
import { createDb } from './db/client.js';
import { getOrCreatePerson, type Person } from './people.js';
import { requireMembership } from './groups.js';
import { claimPlaceholder, getSharedSummary } from './sharing.js';
import { addPlaceholderMember, removeMember, renameMember, setPaymentHandles } from './members.js';
import { createExpense, deleteExpense, getBalances, restoreExpense, updateExpense } from './expenses.js';
import { createItemizedExpense, updateItemizedExpense } from './itemizedExpenses.js';
import { listExpenses } from './expenseList.js';
import { deleteSettlement, getSuggestedPayments, listSettlements, recordSettlement } from './settlements.js';
import { createQuickSplit } from './quicksplit.js';
import { writeEvent } from './events.js';
import { createExpenseBody, itemizedBody, recordSettlementBody, quickSplitBody } from './bodies.js';
import { notifyGroupChanged } from './realtime.js';

type Vars = { person: Person };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// Every API route hangs off this, mounted below at both prefixes.
const api = new Hono<{ Bindings: Env; Variables: Vars }>();

// Security headers on every response + a same-origin CSRF guard on state-changing requests.
// The GET WebSocket upgrade for realtime is a safe method, so it passes through untouched.
app.use('*', harden());

// API responses depend on the caller and must never be cached, including signed-out responses.
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

// Fingerprinted bundles and versioned fonts are immutable. Stable shell URLs must revalidate.
const IMMUTABLE = /^\/(assets\/|fonts\/)/;

const isApiPath = (path: string) => path.startsWith('/api') || path.startsWith('/owewell');

app.use('*', async (c, next) => {
  await next();
  // Both API prefixes, or this overwrites the no-store that noStore() just set and makes
  // per-user responses cacheable again.
  if (isApiPath(c.req.path) || c.req.path === '/health') return;
  c.header('Cache-Control', IMMUTABLE.test(c.req.path) ? 'public, max-age=31536000, immutable' : 'no-cache');
});

app.all('/api/analytics', (c) => handleAnalytics(c.req.raw, c.env));

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

registerGroupRoutes(api);

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
  writeEvent(c.env, 'expense_added', rest.splitMethod, '', participants.length);
  c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
  return c.json({ expense }, 201);
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
  writeEvent(c.env, 'settlement_recorded', parsed.data.method ?? 'unspecified');
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
  writeEvent(c.env, 'quick_split_used', '', '', parsed.data.people.length);
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

app.onError(handleApiError);

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
