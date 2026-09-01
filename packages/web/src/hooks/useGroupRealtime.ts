import { useEffect, useRef } from 'react';
import { API_BASE } from '../lib/api';

/**
 * WebSocket URL for a group's realtime room, one Durable Object per group. Built from API_BASE,
 * so it follows the API prefix automatically. Same origin in production; Vite proxies it in dev.
 */
function realtimeUrl(groupId: string): string {
  const base = new URL(`${API_BASE}/groups/${groupId}/ws`, window.location.origin);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return base.toString();
}

/**
 * Subscribe to live updates for a group and run `onChange` whenever the server reports that
 * group changed. Membership is enforced server-side on connect, and the room subscribes the
 * socket automatically, so the client only listens. Reconnects if the socket drops.
 */
export function useGroupRealtime(groupId: string, onChange: () => void): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!groupId) return;

    let socket: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function connect(): void {
      socket = new WebSocket(realtimeUrl(groupId));

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: unknown; groupId?: unknown };
          if (message.type === 'group:changed' && message.groupId === groupId) {
            onChangeRef.current();
          }
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = () => {
        if (stopped) return;
        retry = setTimeout(connect, 2000);
      };
    }

    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [groupId]);
}
