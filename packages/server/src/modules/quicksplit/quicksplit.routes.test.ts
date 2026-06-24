import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';

const email = `qs-${randomUUID()}@example.com`;
const password = 'correct horse battery';

describe('quick-split save', () => {
  let app: FastifyInstance;
  let cookie = '';
  let userId = '';

  beforeAll(async () => {
    app = await buildApp(loadEnv({ ...process.env, NODE_ENV: 'test' }));
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password, displayName: 'Ann' },
    });
    const c = res.cookies.find((x) => x.name === 'owe_well_session');
    cookie = `${c?.name}=${c?.value}`;
    userId = (res.json() as { user: { id: string } }).user.id;
  });

  afterAll(async () => {
    const user = await app.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      await app.prisma.group.deleteMany({ where: { createdById: user.id } });
    }
    await app.prisma.user.deleteMany({ where: { isPlaceholder: true, memberships: { none: {} } } });
    await app.prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  test('saves a guest split as a group with placeholder members and correct balances', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/quick-splits',
      headers: { cookie },
      payload: {
        description: 'Dinner',
        amountCents: 3000,
        splitMethod: 'EQUAL',
        participants: [
          { name: 'Ann', isPayer: true, isYou: true },
          { name: 'Bob' },
          { name: 'Cara' },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const groupId = (res.json() as { groupId: string }).groupId;

    const group = await app.inject({ method: 'GET', url: `/groups/${groupId}`, headers: { cookie } });
    const members = (
      group.json() as { group: { members: { displayName: string; isPlaceholder: boolean }[] } }
    ).group.members;
    expect(members).toHaveLength(3);
    expect(members.filter((m) => m.isPlaceholder)).toHaveLength(2);

    const balances = await app.inject({
      method: 'GET',
      url: `/groups/${groupId}/balances`,
      headers: { cookie },
    });
    const list = (balances.json() as { balances: { userId: string; netCents: number }[] }).balances;
    // Ann paid 3000, split equally 3 ways -> she is owed 2000; sum is zero.
    expect(list.find((b) => b.userId === userId)?.netCents).toBe(2000);
    expect(list.reduce((sum, b) => sum + b.netCents, 0)).toBe(0);
  });

  test('rejects a split with no payer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/quick-splits',
      headers: { cookie },
      payload: {
        description: 'No payer',
        amountCents: 1000,
        splitMethod: 'EQUAL',
        participants: [{ name: 'Ann' }, { name: 'Bob' }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe('NO_PAYER');
  });

  test('rejects an invalid split (percentages must total 100)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/quick-splits',
      headers: { cookie },
      payload: {
        description: 'Bad percent',
        amountCents: 1000,
        splitMethod: 'PERCENT',
        participants: [
          { name: 'Ann', value: 6000, isPayer: true },
          { name: 'Bob', value: 3000 },
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe('INVALID_SPLIT');
  });

  test('requires sign-in', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/quick-splits',
      payload: {
        amountCents: 1000,
        splitMethod: 'EQUAL',
        participants: [{ name: 'Ann', isPayer: true }],
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
