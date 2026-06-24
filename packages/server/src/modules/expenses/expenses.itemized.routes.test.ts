import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';

const emailA = `item-a-${randomUUID()}@example.com`;
const emailB = `item-b-${randomUUID()}@example.com`;
const emailC = `item-c-${randomUUID()}@example.com`;
const password = 'correct horse battery';

interface Registered {
  cookie: string;
  id: string;
}

async function register(app: FastifyInstance, email: string, name: string): Promise<Registered> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password, displayName: name },
  });
  const cookie = res.cookies.find((c) => c.name === 'owe_well_session');
  if (!cookie) throw new Error('no session cookie');
  return { cookie: `${cookie.name}=${cookie.value}`, id: (res.json() as { user: { id: string } }).user.id };
}

describe('itemized expense route', () => {
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
      payload: { name: 'Dinner' },
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

  test('creates an itemized expense with proportional tax and correct balances', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/expenses/itemized`,
      headers: { cookie: ann.cookie },
      payload: {
        description: 'Restaurant',
        payerId: ann.id,
        taxCents: 300,
        items: [
          { name: 'Burger', amountCents: 1000, participantIds: [ann.id] },
          { name: 'Pizza', amountCents: 2000, participantIds: [ann.id, bob.id] },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const expense = res.json() as {
      expense: { amountCents: number; splitMethod: string; splits: { userId: string; owedCents: number }[] };
    };
    expect(expense.expense.amountCents).toBe(3300);
    expect(expense.expense.splitMethod).toBe('ITEMIZED');

    const owed = Object.fromEntries(expense.expense.splits.map((s) => [s.userId, s.owedCents]));
    // Ann: 1000 + 1000 + 200 tax = 2200. Bob: 1000 + 100 tax = 1100.
    expect(owed[ann.id]).toBe(2200);
    expect(owed[bob.id]).toBe(1100);

    const itemCount = await app.prisma.expenseItem.count({ where: { expense: { groupId } } });
    expect(itemCount).toBe(2);

    const balances = await app.inject({
      method: 'GET',
      url: `/groups/${groupId}/balances`,
      headers: { cookie: ann.cookie },
    });
    const net = Object.fromEntries(
      (balances.json() as { balances: { userId: string; netCents: number }[] }).balances.map((b) => [
        b.userId,
        b.netCents,
      ]),
    );
    expect(net[ann.id]).toBe(1100);
    expect(net[bob.id]).toBe(-1100);
  });

  test('rejects an item assigned to a non-member', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/expenses/itemized`,
      headers: { cookie: ann.cookie },
      payload: {
        description: 'Sneaky',
        payerId: ann.id,
        items: [{ name: 'Fries', amountCents: 500, participantIds: [cara.id] }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe('INVALID_PARTICIPANT');
  });

  test('rejects an empty item list', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/expenses/itemized`,
      headers: { cookie: ann.cookie },
      payload: { description: 'Nothing', payerId: ann.id, items: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});
