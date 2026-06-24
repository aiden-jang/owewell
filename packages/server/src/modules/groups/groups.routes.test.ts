import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';

const emailA = `group-a-${randomUUID()}@example.com`;
const emailB = `group-b-${randomUUID()}@example.com`;
const password = 'correct horse battery';

async function registerAndCookie(
  app: FastifyInstance,
  email: string,
  displayName: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password, displayName },
  });
  const cookie = res.cookies.find((c) => c.name === 'owe_well_session');
  if (!cookie) throw new Error('no session cookie from register');
  return `${cookie.name}=${cookie.value}`;
}

describe('group routes', () => {
  let app: FastifyInstance;
  let cookieA = '';
  let cookieB = '';

  beforeAll(async () => {
    app = await buildApp(loadEnv({ ...process.env, NODE_ENV: 'test' }));
    cookieA = await registerAndCookie(app, emailA, 'Ann');
    cookieB = await registerAndCookie(app, emailB, 'Bob');
  });

  afterAll(async () => {
    const users = await app.prisma.user.findMany({
      where: { email: { in: [emailA, emailB] } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    // Groups restrict deletion of their creator, so remove them first (cascades members).
    await app.prisma.group.deleteMany({ where: { createdById: { in: ids } } });
    await app.prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
    await app.close();
  });

  test('create requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/groups', payload: { name: 'Trip' } });
    expect(res.statusCode).toBe(401);
  });

  test('owner can create, list, and read a group; outsiders cannot', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/groups',
      headers: { cookie: cookieA },
      payload: { name: 'Tahoe Trip' },
    });
    expect(created.statusCode).toBe(201);
    const group = (created.json() as { group: { id: string; members: unknown[] } }).group;
    expect(group.members).toHaveLength(1);

    const listA = await app.inject({ method: 'GET', url: '/groups', headers: { cookie: cookieA } });
    expect((listA.json() as { groups: { memberCount: number }[] }).groups[0]?.memberCount).toBe(1);

    // Bob is not a member yet: list is empty and direct read is 404.
    const listB = await app.inject({ method: 'GET', url: '/groups', headers: { cookie: cookieB } });
    expect((listB.json() as { groups: unknown[] }).groups).toHaveLength(0);

    const readB = await app.inject({
      method: 'GET',
      url: `/groups/${group.id}`,
      headers: { cookie: cookieB },
    });
    expect(readB.statusCode).toBe(404);
  });

  test('a member can add another by email, with sensible errors', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/groups',
      headers: { cookie: cookieA },
      payload: { name: 'Dinner' },
    });
    const groupId = (created.json() as { group: { id: string } }).group.id;

    const add = await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/members`,
      headers: { cookie: cookieA },
      payload: { email: emailB },
    });
    expect(add.statusCode).toBe(201);

    // Bob can now read the group and sees two members.
    const readB = await app.inject({
      method: 'GET',
      url: `/groups/${groupId}`,
      headers: { cookie: cookieB },
    });
    expect(readB.statusCode).toBe(200);
    expect((readB.json() as { group: { members: unknown[] } }).group.members).toHaveLength(2);

    // Adding the same person again is a conflict.
    const dup = await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/members`,
      headers: { cookie: cookieA },
      payload: { email: emailB },
    });
    expect(dup.statusCode).toBe(409);

    // Adding an unknown email is a 404.
    const unknown = await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/members`,
      headers: { cookie: cookieA },
      payload: { email: `nobody-${randomUUID()}@example.com` },
    });
    expect(unknown.statusCode).toBe(404);
    expect((unknown.json() as { error: string }).error).toBe('USER_NOT_FOUND');
  });

  test('a non-member cannot add members', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/groups',
      headers: { cookie: cookieA },
      payload: { name: 'Private' },
    });
    const groupId = (created.json() as { group: { id: string } }).group.id;

    const res = await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/members`,
      headers: { cookie: cookieB },
      payload: { email: emailA },
    });
    expect(res.statusCode).toBe(404);
  });
});
