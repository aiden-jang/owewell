import { useEffect, useRef } from 'react';

/**
 * Subscribe to live updates for a group over WebSocket and run `onChange`
 * whenever the server reports that group changed. Reconnects if the socket drops.
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
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'subscribe', groupId }));
      };

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
