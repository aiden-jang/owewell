import fp from 'fastify-plugin';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { SESSION_COOKIE, validateSessionToken } from '../lib/session.js';
import { GROUP_CHANGED, realtimeBus } from './bus.js';

interface SubscribeMessage {
  type: 'subscribe';
  groupId: string;
}

function isSubscribe(value: unknown): value is SubscribeMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'subscribe' &&
    typeof (value as { groupId?: unknown }).groupId === 'string'
  );
}

/**
 * WebSocket fan-out: clients connect to /ws, authenticate via the session cookie,
 * and subscribe to groups they belong to. When a group changes, every subscribed
 * socket gets a `group:changed` message and the client refetches.
 */
export default fp(
  async (app) => {
    await app.register(websocket);

    const rooms = new Map<string, Set<WebSocket>>();

    function join(groupId: string, socket: WebSocket): void {
      let room = rooms.get(groupId);
      if (!room) {
        room = new Set();
        rooms.set(groupId, room);
      }
      room.add(socket);
    }

    function leave(groupId: string, socket: WebSocket): void {
      const room = rooms.get(groupId);
      if (!room) return;
      room.delete(socket);
      if (room.size === 0) rooms.delete(groupId);
    }

    function broadcast(groupId: string, data: string): void {
      const room = rooms.get(groupId);
      if (!room) return;
      for (const socket of room) {
        if (socket.readyState === socket.OPEN) socket.send(data);
      }
    }

    const onChanged = (groupId: string): void => {
      broadcast(groupId, JSON.stringify({ type: 'group:changed', groupId }));
    };
    realtimeBus.on(GROUP_CHANGED, onChanged);
    app.addHook('onClose', () => {
      realtimeBus.off(GROUP_CHANGED, onChanged);
    });

    app.get('/ws', { websocket: true }, (socket, request) => {
      const subscriptions = new Set<string>();
      let userId: string | null = null;

      // Authenticate once; queued messages await this before doing anything.
      const ready = (async () => {
        const token = request.cookies[SESSION_COOKIE];
        const user = token ? await validateSessionToken(app.prisma, token) : null;
        if (!user) {
          socket.close(4401, 'unauthorized');
          return;
        }
        userId = user.id;
      })();

      socket.on('message', (raw: Buffer) => {
        void (async () => {
          await ready;
          if (!userId) return;
          let message: unknown;
          try {
            message = JSON.parse(raw.toString());
          } catch {
            return;
          }
          if (!isSubscribe(message)) return;

          const membership = await app.prisma.groupMember.findUnique({
            where: { groupId_userId: { groupId: message.groupId, userId } },
          });
          if (!membership) return;

          subscriptions.add(message.groupId);
          join(message.groupId, socket);
          socket.send(JSON.stringify({ type: 'subscribed', groupId: message.groupId }));
        })();
      });

      socket.on('close', () => {
        for (const groupId of subscriptions) leave(groupId, socket);
      });
    });
  },
  { name: 'realtime', dependencies: ['prisma'] },
);
