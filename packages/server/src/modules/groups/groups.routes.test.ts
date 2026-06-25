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
    url: '/api/auth/register',
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
    // Placeholder users are left orphaned once their memberships are gone.
    await app.prisma.user.deleteMany({ where: { isPlaceholder: true, memberships: { none: {} } } });
    await app.prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
    await app.close();
  });

  test('create requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/groups', payload: { name: 'Trip' } });
    expect(res.statusCode).toBe(401);
  });

  test('owner can create, list, and read a group; outsiders cannot', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { cookie: cookieA },
      payload: { name: 'Tahoe Trip' },
    });
    expect(created.statusCode).toBe(201);
    const group = (created.json() as { group: { id: string; members: unknown[] } }).group;
    expect(group.members).toHaveLength(1);

    const listA = await app.inject({ method: 'GET', url: '/api/groups', headers: { cookie: cookieA } });
    expect((listA.json() as { groups: { memberCount: number }[] }).groups[0]?.memberCount).toBe(1);

    // Bob is not a member yet: list is empty and direct read is 404.
    const listB = await app.inject({ method: 'GET', url: '/api/groups', headers: { cookie: cookieB } });
    expect((listB.json() as { groups: unknown[] }).groups).toHaveLength(0);

    const readB = await app.inject({
      method: 'GET',
      url: `/api/groups/${group.id}`,
      headers: { cookie: cookieB },
    });
    expect(readB.statusCode).toBe(404);
  });

  test('a member can add another by email, with sensible errors', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { cookie: cookieA },
      payload: { name: 'Dinner' },
    });
    const groupId = (created.json() as { group: { id: string } }).group.id;

    const add = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { cookie: cookieA },
      payload: { email: emailB },
    });
    expect(add.statusCode).toBe(201);

    // Bob can now read the group and sees two members.
    const readB = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { cookie: cookieB },
    });
    expect(readB.statusCode).toBe(200);
    expect((readB.json() as { group: { members: unknown[] } }).group.members).toHaveLength(2);

    // Adding the same person again is a conflict.
    const dup = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { cookie: cookieA },
      payload: { email: emailB },
    });
    expect(dup.statusCode).toBe(409);

    // Adding an unknown email is a 404.
    const unknown = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { cookie: cookieA },
      payload: { email: `nobody-${randomUUID()}@example.com` },
    });
    expect(unknown.statusCode).toBe(404);
    expect((unknown.json() as { error: string }).error).toBe('USER_NOT_FOUND');
  });

  test('a member can add a name-only placeholder person', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { cookie: cookieA },
      payload: { name: 'Roadtrip' },
    });
    const groupId = (created.json() as { group: { id: string } }).group.id;

    const add = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { cookie: cookieA },
      payload: { name: 'Charlie' },
    });
    expect(add.statusCode).toBe(201);
    const member = (
      add.json() as { member: { displayName: string; email: string | null; isPlaceholder: boolean } }
    ).member;
    expect(member.displayName).toBe('Charlie');
    expect(member.isPlaceholder).toBe(true);
    expect(member.email).toBeNull();

    const read = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { cookie: cookieA },
    });
    expect((read.json() as { group: { members: unknown[] } }).group.members).toHaveLength(2);
  });

  test('owner can rename and delete a group; non-owners cannot', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { cookie: cookieA },
      payload: { name: 'Cabin' },
    });
    const groupId = (created.json() as { group: { id: string } }).group.id;
    await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { cookie: cookieA },
      payload: { email: emailB },
    });

    const bobRename = await app.inject({
      method: 'PATCH',
      url: `/api/groups/${groupId}`,
      headers: { cookie: cookieB },
      payload: { name: 'Hacked' },
    });
    expect(bobRename.statusCode).toBe(403);
    const bobDelete = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${groupId}`,
      headers: { cookie: cookieB },
    });
    expect(bobDelete.statusCode).toBe(403);

    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/groups/${groupId}`,
      headers: { cookie: cookieA },
      payload: { name: 'Lake Cabin' },
    });
    expect(rename.statusCode).toBe(200);
    expect((rename.json() as { group: { name: string } }).group.name).toBe('Lake Cabin');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${groupId}`,
      headers: { cookie: cookieA },
    });
    expect(del.statusCode).toBe(200);
    const read = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { cookie: cookieA },
    });
    expect(read.statusCode).toBe(404);
  });

  test('member removal: owner-only, owner-protected, activity-guarded, self-leave', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { cookie: cookieA },
      payload: { name: 'Squad' },
    });
    const detail = created.json() as { group: { id: string; members: { userId: string; role: string }[] } };
    const groupId = detail.group.id;
    const annId = detail.group.members[0]!.userId;
    const addBob = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { cookie: cookieA },
      payload: { email: emailB },
    });
    const bobId = (addBob.json() as { member: { userId: string } }).member.userId;
    const addCharlie = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { cookie: cookieA },
      payload: { name: 'Charlie' },
    });
    const charlieId = (addCharlie.json() as { member: { userId: string } }).member.userId;

    // Bob (non-owner) cannot remove Charlie.
    const bobRemoves = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${groupId}/members/${charlieId}`,
      headers: { cookie: cookieB },
    });
    expect(bobRemoves.statusCode).toBe(403);
    expect((bobRemoves.json() as { error: string }).error).toBe('NOT_OWNER');

    // The owner cannot be removed.
    const removeOwner = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${groupId}/members/${annId}`,
      headers: { cookie: cookieA },
    });
    expect(removeOwner.statusCode).toBe(403);
    expect((removeOwner.json() as { error: string }).error).toBe('CANNOT_REMOVE_OWNER');

    // Owner removes Charlie (no activity) — fine.
    const removeCharlie = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${groupId}/members/${charlieId}`,
      headers: { cookie: cookieA },
    });
    expect(removeCharlie.statusCode).toBe(200);

    // Bob joins an expense, then can't be removed until it's cleared.
    await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/expenses`,
      headers: { cookie: cookieA },
      payload: {
        description: 'Gas',
        amountCents: 1000,
        payerId: annId,
        splitMethod: 'EQUAL',
        participants: [{ userId: annId }, { userId: bobId }],
      },
    });
    const removeBob = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${groupId}/members/${bobId}`,
      headers: { cookie: cookieA },
    });
    expect(removeBob.statusCode).toBe(409);
    expect((removeBob.json() as { error: string }).error).toBe('HAS_ACTIVITY');

    // A clean group: Bob can leave on his own.
    const g2 = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { cookie: cookieA },
      payload: { name: 'Empty' },
    });
    const g2Id = (g2.json() as { group: { id: string } }).group.id;
    await app.inject({
      method: 'POST',
      url: `/api/groups/${g2Id}/members`,
      headers: { cookie: cookieA },
      payload: { email: emailB },
    });
    const leave = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${g2Id}/members/${bobId}`,
      headers: { cookie: cookieB },
    });
    expect(leave.statusCode).toBe(200);
  });

  test('a non-member cannot add members', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { cookie: cookieA },
      payload: { name: 'Private' },
    });
    const groupId = (created.json() as { group: { id: string } }).group.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { cookie: cookieB },
      payload: { email: emailA },
    });
    expect(res.statusCode).toBe(404);
  });
});
