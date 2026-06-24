import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';

const emailA = `rt-a-${randomUUID()}@example.com`;
const emailB = `rt-b-${randomUUID()}@example.com`;
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

/** Resolve with the first message whose parsed `type` matches. */
function nextMessage(socket: WebSocket, type: string): Promise<{ type: string; groupId?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 4000);
    socket.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as { type: string; groupId?: string };
      if (msg.type === type) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

function open(url: string, cookie: string): Promise<WebSocket> {
  const socket = new WebSocket(url, { headers: { cookie } });
  return new Promise((resolve, reject) => {
    socket.on('open', () => resolve(socket));
    socket.on('error', reject);
  });
}

describe('realtime group updates', () => {
  let app: FastifyInstance;
  let wsUrl = '';
  let ann: Registered;
  let bob: Registered;
  let groupId = '';

  beforeAll(async () => {
    app = await buildApp(loadEnv({ ...process.env, NODE_ENV: 'test' }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    wsUrl = `ws://127.0.0.1:${port}/ws`;

    ann = await register(app, emailA, 'Ann');
    bob = await register(app, emailB, 'Bob');
    const created = await app.inject({
      method: 'POST',
      url: '/groups',
      headers: { cookie: ann.cookie },
      payload: { name: 'Live' },
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
      where: { email: { in: [emailA, emailB] } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await app.prisma.group.deleteMany({ where: { createdById: { in: ids } } });
    await app.prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  test('subscribed members are notified when an expense is added', async () => {
    const socket = await open(wsUrl, bob.cookie);
    try {
      const subscribed = nextMessage(socket, 'subscribed');
      socket.send(JSON.stringify({ type: 'subscribe', groupId }));
      await subscribed;

      const changed = nextMessage(socket, 'group:changed');
      // Ann adds an expense over HTTP; Bob's socket should hear about it.
      await app.inject({
        method: 'POST',
        url: `/groups/${groupId}/expenses`,
        headers: { cookie: ann.cookie },
        payload: {
          description: 'Cab',
          amountCents: 1000,
          payerId: ann.id,
          splitMethod: 'EQUAL',
          participants: [{ userId: ann.id }, { userId: bob.id }],
        },
      });

      const msg = await changed;
      expect(msg.groupId).toBe(groupId);
    } finally {
      socket.close();
    }
  });

  test('a connection without a valid session is closed', async () => {
    const socket = new WebSocket(wsUrl, { headers: { cookie: 'owe_well_session=bogus' } });
    const code = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no close')), 4000);
      socket.on('close', (c: number) => {
        clearTimeout(timer);
        resolve(c);
      });
      socket.on('error', () => undefined);
    });
    expect(code).toBe(4401);
  });
});
