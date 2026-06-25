import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';

const emailA = `inv-a-${randomUUID()}@example.com`;
const emailB = `inv-b-${randomUUID()}@example.com`;
const emailC = `inv-c-${randomUUID()}@example.com`;
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

describe('invite routes', () => {
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

  async function createInvite(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/invites`,
      headers: { cookie: ann.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { invite: { token: string } }).invite.token;
  }

  test('a member creates an invite; a stranger can look it up and accept to join', async () => {
    const token = await createInvite();

    // Public lookup, no auth.
    const info = await app.inject({ method: 'GET', url: `/api/invites/${token}` });
    expect(info.statusCode).toBe(200);
    const body = info.json() as { invite: { groupName: string; status: string } };
    expect(body.invite.groupName).toBe('Trip');
    expect(body.invite.status).toBe('pending');

    // Bob accepts and becomes a member.
    const accept = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}/accept`,
      headers: { cookie: bob.cookie },
    });
    expect(accept.statusCode).toBe(200);
    expect((accept.json() as { groupId: string }).groupId).toBe(groupId);

    const group = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { cookie: bob.cookie },
    });
    expect(group.statusCode).toBe(200);
    expect((group.json() as { group: { members: unknown[] } }).group.members).toHaveLength(2);

    // The invite is single-use.
    const reuse = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}/accept`,
      headers: { cookie: cara.cookie },
    });
    expect(reuse.statusCode).toBe(409);
    expect((reuse.json() as { error: string }).error).toBe('ALREADY_ACCEPTED');
  });

  test('accepting requires sign-in', async () => {
    const token = await createInvite();
    const res = await app.inject({ method: 'POST', url: `/api/invites/${token}/accept` });
    expect(res.statusCode).toBe(401);
  });

  test('an unknown token is a 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invites/not-a-real-token' });
    expect(res.statusCode).toBe(404);
  });

  test('an expired invite cannot be accepted', async () => {
    const token = await createInvite();
    await app.prisma.invite.update({
      where: { token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}/accept`,
      headers: { cookie: bob.cookie },
    });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('EXPIRED');
  });

  test('a non-member cannot create an invite', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/invites`,
      headers: { cookie: cara.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
