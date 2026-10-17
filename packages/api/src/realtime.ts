import type { Env } from './env.js';

/** Hibernating notification sockets per group. The Worker checks auth and membership before upgrade. */
export class GroupRoom {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      const groupId = url.searchParams.get('groupId') ?? '';
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      // Hand the server socket to the runtime; it survives hibernation without a live isolate.
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'subscribed', groupId }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const { groupId } = (await request.json()) as { groupId: string };
      const payload = JSON.stringify({ type: 'group:changed', groupId });
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(payload);
        } catch {
          // socket is closing; drop it silently
        }
      }
      return new Response(null, { status: 204 });
    }

    return new Response('not found', { status: 404 });
  }

  // Subscription is implicit (one object per group), so client frames need no handling.
  // Reply to a ping so idle clients can keep-alive without a refetch.
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message === 'string' && message === 'ping') ws.send('pong');
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  webSocketError(): void {
    // nothing to clean up; the runtime drops the socket
  }
}

/**
 * Tell a group's room that its data changed. Fire-and-forget from the caller's side, but
 * hand the returned promise to `executionCtx.waitUntil` so the broadcast isn't cancelled
 * when the HTTP response returns.
 */
export async function notifyGroupChanged(env: Env, groupId: string): Promise<void> {
  const stub = env.REALTIME.get(env.REALTIME.idFromName(groupId));
  await stub.fetch('https://room/broadcast', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ groupId }),
  });
}
