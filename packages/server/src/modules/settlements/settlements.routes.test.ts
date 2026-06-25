import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';

const emailA = `set-a-${randomUUID()}@example.com`;
const emailB = `set-b-${randomUUID()}@example.com`;
const emailC = `set-c-${randomUUID()}@example.com`;
const password = 'correct horse battery';

interface Registered {
  cookie: string;
  id: string;
}

async function register(app: FastifyInstance, email: string, name: string): Promise<Registered> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password, displayName: name },
  });
  const cookie = res.cookies.find((c) => c.name === 'owe_well_session');
  if (!cookie) throw new Error('no session cookie');
  return { cookie: `${cookie.name}=${cookie.value}`, id: (res.json() as { user: { id: string } }).user.id };
}

describe('settlement routes', () => {
  let app: FastifyInstance;
  let ann: Registered;
  let bob: Registered;
  let cara: Registered;
  let groupId = '';

  beforeAll(async () => {
    app = await buildApp(loadEnv({ ...process.env, NODE_ENV: 'test' }));
    ann = await register(app, emailA, 'Ann');
    bob = await register(app, emailB, 'Bob');
    cara = await register(app, emailC, 'Cara');

    const created = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { cookie: ann.cookie },
      payload: { name: 'Trip' },
    });
    groupId = (created.json() as { group: { id: string } }).group.id;
    await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { cookie: ann.cookie },
      payload: { email: emailB },
    });
    // Ann pays 1000 split equally -> Bob owes Ann 500.
    await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/expenses`,
      headers: { cookie: ann.cookie },
      payload: {
        description: 'Hotel',
        amountCents: 1000,
        payerId: ann.id,
        splitMethod: 'EQUAL',
        participants: [{ userId: ann.id }, { userId: bob.id }],
      },
    });
  });

  afterAll(async () => {
    const users = await app.prisma.user.findMany({
      where: { email: { in: [emailA, emailB, emailC] } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await app.prisma.group.deleteMany({ where: { createdById: { in: ids } } });
    await app.prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  test('suggests Bob pays Ann, then a recorded payment clears the balance', async () => {
    const before = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}/suggested-payments`,
      headers: { cookie: ann.cookie },
    });
    const suggested = (before.json() as { payments: { fromUserId: string; toUserId: string; amountCents: number }[] })
      .payments;
    expect(suggested).toEqual([
      { fromUserId: bob.id, fromName: 'Bob', toUserId: ann.id, toName: 'Ann', amountCents: 500 },
    ]);

    const settle = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/settlements`,
      headers: { cookie: bob.cookie },
      payload: { fromUserId: bob.id, toUserId: ann.id, amountCents: 500 },
    });
    expect(settle.statusCode).toBe(201);

    const balances = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}/balances`,
      headers: { cookie: ann.cookie },
    });
    const net = Object.fromEntries(
      (balances.json() as { balances: { userId: string; netCents: number }[] }).balances.map((b) => [
        b.userId,
        b.netCents,
      ]),
    );
    expect(net[ann.id]).toBe(0);
    expect(net[bob.id]).toBe(0);

    const after = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}/suggested-payments`,
      headers: { cookie: ann.cookie },
    });
    expect((after.json() as { payments: unknown[] }).payments).toEqual([]);

    const list = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}/settlements`,
      headers: { cookie: ann.cookie },
    });
    expect((list.json() as { settlements: unknown[] }).settlements).toHaveLength(1);
  });

  test('rejects a payment to yourself', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/settlements`,
      headers: { cookie: ann.cookie },
      payload: { fromUserId: ann.id, toUserId: ann.id, amountCents: 100 },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe('SAME_PARTY');
  });

  test('rejects a payment involving a non-member', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/settlements`,
      headers: { cookie: ann.cookie },
      payload: { fromUserId: ann.id, toUserId: cara.id, amountCents: 100 },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe('INVALID_PARTICIPANT');
  });

  test('a non-member cannot see suggested payments', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}/suggested-payments`,
      headers: { cookie: cara.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
