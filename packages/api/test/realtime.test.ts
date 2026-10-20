import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { notifyGroupChanged } from '../src/realtime.js';
import type { GroupRoom } from '../src/realtime.js';

/**
 * The live-updates room.
 *
 * One Durable Object per group, holding that group's sockets. Everything here fails quietly if it
 * breaks: a broadcast that reaches nobody just means the group page silently goes stale, and one
 * closing socket taking the loop down means the people still connected stop hearing about changes
 * without anything being logged.
 *
 * Auth is enforced in the Worker before the upgrade is routed here, so the room itself trusts every
 * socket it holds. That is deliberate, and it is why these tests are about delivery rather than
 * about who is allowed to listen.
 */

const roomFor = (groupId: string) => {
  const id = env.REALTIME.idFromName(groupId);
  return { id, stub: env.REALTIME.get(id) };
};

/*
 * Close both ends of every test socket so another test cannot inherit its broadcasts or presence.
 */
const opened: WebSocket[] = [];
const rooms = new Set<DurableObjectStub>();
afterEach(async () => {
  for (const ws of opened.splice(0)) {
    try {
      ws.close();
    } catch {
      // already gone
    }
  }
  // The server side too: a room still holding an accepted socket cannot be evicted.
  for (const stub of rooms) {
    await runInDurableObject(stub, (_room: GroupRoom, state: DurableObjectState) => {
      for (const ws of state.getWebSockets()) {
        try {
          ws.close();
        } catch {
          // already gone
        }
      }
    });
  }
  rooms.clear();
});

/** Open a socket against the room the way the Worker does, and collect what it receives. */
async function connect(stub: DurableObjectStub, groupId: string) {
  const res = await stub.fetch(`https://room/?groupId=${groupId}`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const seen: string[] = [];
  ws.accept();
  ws.addEventListener('message', (e: MessageEvent) => seen.push(String(e.data)));
  opened.push(ws);
  rooms.add(stub);
  return { ws, seen };
}

describe('joining a room', () => {
  test('upgrades and confirms which group you are in', async () => {
    const { stub } = roomFor('g1');
    const { seen } = await connect(stub, 'g1');
    await vi.waitFor(() =>
      expect(seen.map((s) => JSON.parse(s))).toContainEqual({ type: 'subscribed', groupId: 'g1' }),
    );
  });

  test('anything that is not an upgrade or a broadcast is a 404', async () => {
    const { stub } = roomFor('g1');
    expect((await stub.fetch('https://room/whatever')).status).toBe(404);
    // /broadcast is POST-only; a GET must not fall through to it.
    expect((await stub.fetch('https://room/broadcast')).status).toBe(404);
  });
});

describe('broadcasting a change', () => {
  test('reaches every socket in the room', async () => {
    const { stub } = roomFor('g2');
    const a = await connect(stub, 'g2');
    const b = await connect(stub, 'g2');

    const res = await stub.fetch('https://room/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId: 'g2' }),
    });
    expect(res.status).toBe(204);
    for (const side of [a, b]) {
      await vi.waitFor(() =>
        expect(side.seen.map((s) => JSON.parse(s))).toContainEqual({ type: 'group:changed', groupId: 'g2' }),
      );
    }
  });

  /*
   * A socket that throws on send must not take the rest of the loop with it. Without the try/catch
   * around each send, one client closing mid-broadcast stops delivery to everybody after it in the
   * list, and nothing surfaces — the remaining pages simply stop updating.
   */
  test('one dead socket does not stop the others hearing about it', async () => {
    const { stub } = roomFor('g3');
    await connect(stub, 'g3');
    await connect(stub, 'g3');

    await runInDurableObject(stub, async (room: GroupRoom, state: DurableObjectState) => {
      const sockets = state.getWebSockets();
      expect(sockets.length).toBeGreaterThanOrEqual(2);
      // Make the first one throw the way a closing socket does.
      const broken = sockets[0]!;
      broken.send = () => {
        throw new Error('socket is closing');
      };
      const delivered: string[] = [];
      for (const ws of sockets.slice(1)) {
        const real = ws.send.bind(ws);
        ws.send = (msg: string) => {
          delivered.push(String(msg));
          real(msg);
        };
      }
      const res = await room.fetch(
        new Request('https://room/broadcast', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ groupId: 'g3' }),
        }),
      );
      expect(res.status).toBe(204);
      expect(delivered.map((d) => JSON.parse(d))).toContainEqual({ type: 'group:changed', groupId: 'g3' });
    });
  });

  // Rooms are addressed by group id, so a change in one group is not another group's business.
  test('does not reach a different group', async () => {
    const mine = roomFor('g4');
    const theirs = roomFor('g5');
    const listener = await connect(theirs.stub, 'g5');

    await mine.stub.fetch('https://room/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId: 'g4' }),
    });
    // A negative has nothing to wait for, so it waits out the delivery window instead.
    await new Promise((r) => setTimeout(r, 250));
    expect(listener.seen.map((s) => JSON.parse(s)).filter((m) => m.type === 'group:changed')).toEqual([]);
  });
});

describe('keeping a quiet connection open', () => {
  test('answers a ping so an idle client need not refetch to prove it is alive', async () => {
    const { stub } = roomFor('g6');
    const { ws, seen } = await connect(stub, 'g6');
    ws.send('ping');
    await vi.waitFor(() => expect(seen).toContain('pong'));
  });

  test('ignores anything else a client sends', async () => {
    const { stub } = roomFor('g7');
    const { ws, seen } = await connect(stub, 'g7');
    // Wait for the subscribed frame first, or it lands after the baseline and reads as a reply.
    await vi.waitFor(() => expect(seen.length).toBe(1));
    ws.send('subscribe me to everything');
    await new Promise((r) => setTimeout(r, 250));
    expect(seen.length).toBe(1);
  });
});

describe('notifyGroupChanged', () => {
  // The helper the routes call. Addressing the wrong room is a silent no-op.
  test('reaches the room for that group and no other', async () => {
    const listener = await connect(roomFor('g8').stub, 'g8');
    const bystander = await connect(roomFor('g9').stub, 'g9');

    await notifyGroupChanged(env, 'g8');
    await vi.waitFor(() =>
      expect(listener.seen.map((s) => JSON.parse(s))).toContainEqual({
        type: 'group:changed',
        groupId: 'g8',
      }),
    );
    expect(bystander.seen.map((s) => JSON.parse(s)).filter((m) => m.type === 'group:changed')).toEqual([]);
  });
});
