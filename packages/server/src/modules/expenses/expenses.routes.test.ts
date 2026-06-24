import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';

const emailA = `exp-a-${randomUUID()}@example.com`;
const emailB = `exp-b-${randomUUID()}@example.com`;
const emailC = `exp-c-${randomUUID()}@example.com`;
const password = 'correct horse battery';

interface Registered {
  cookie: string;
  id: string;
}

async function register(
  app: FastifyInstance,
  email: string,
  displayName: string,
): Promise<Registered> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password, displayName },
  });
  const cookie = res.cookies.find((c) => c.name === 'owe_well_session');
  if (!cookie) throw new Error('no session cookie');
  const id = (res.json() as { user: { id: string } }).user.id;
  return { cookie: `${cookie.name}=${cookie.value}`, id };
}

describe('expense routes', () => {
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
      url: '/groups',
      headers: { cookie: ann.cookie },
      payload: { name: 'Trip' },
    });
    groupId = (created.json() as { group: { id: string } }).group.id;
    await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/members`,
      headers: { cookie: ann.cookie },
      payload: { email: emailB },
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

  test('equal split creates correct shares and balances sum to zero', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/expenses`,
      headers: { cookie: ann.cookie },
      payload: {
        description: 'Hotel',
        amountCents: 1000,
        payerId: ann.id,
        splitMethod: 'EQUAL',
        participants: [{ userId: ann.id }, { userId: bob.id }],
      },
    });
    expect(res.statusCode).toBe(201);
    const expense = (res.json() as { expense: { splits: { userId: string; owedCents: number }[] } })
      .expense;
    const owed = Object.fromEntries(expense.splits.map((s) => [s.userId, s.owedCents]));
    expect(owed[ann.id]).toBe(500);
    expect(owed[bob.id]).toBe(500);

    const balances = await app.inject({
      method: 'GET',
      url: `/groups/${groupId}/balances`,
      headers: { cookie: ann.cookie },
    });
    const list = (balances.json() as { balances: { userId: string; netCents: number }[] }).balances;
    const net = Object.fromEntries(list.map((b) => [b.userId, b.netCents]));
    // Ann paid 1000, owes 500 -> +500. Bob owes 500 -> -500.
    expect(net[ann.id]).toBe(500);
    expect(net[bob.id]).toBe(-500);
    expect(list.reduce((sum, b) => sum + b.netCents, 0)).toBe(0);
  });

  test('rejects a split that does not add up', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/expenses`,
      headers: { cookie: ann.cookie },
      payload: {
        description: 'Bad exact',
        amountCents: 1000,
        payerId: ann.id,
        splitMethod: 'EXACT',
        participants: [
          { userId: ann.id, value: 600 },
          { userId: bob.id, value: 300 },
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe('INVALID_SPLIT');
  });

  test('rejects a participant who is not in the group', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/expenses`,
      headers: { cookie: ann.cookie },
      payload: {
        description: 'Outsider',
        amountCents: 1000,
        payerId: ann.id,
        splitMethod: 'EQUAL',
        participants: [{ userId: ann.id }, { userId: cara.id }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe('INVALID_PARTICIPANT');
  });

  test('a non-member cannot post expenses or read balances', async () => {
    const post = await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/expenses`,
      headers: { cookie: cara.cookie },
      payload: {
        description: 'Sneaky',
        amountCents: 100,
        payerId: cara.id,
        splitMethod: 'EQUAL',
        participants: [{ userId: cara.id }],
      },
    });
    expect(post.statusCode).toBe(404);

    const balances = await app.inject({
      method: 'GET',
      url: `/groups/${groupId}/balances`,
      headers: { cookie: cara.cookie },
    });
    expect(balances.statusCode).toBe(404);
  });

  test('lists live expenses for the group', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/groups/${groupId}/expenses`,
      headers: { cookie: bob.cookie },
    });
    expect(res.statusCode).toBe(200);
    const expenses = (res.json() as { expenses: unknown[] }).expenses;
    expect(expenses.length).toBeGreaterThanOrEqual(1);
  });
});
