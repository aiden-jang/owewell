import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGroupRealtime } from './useGroupRealtime';

/**
 * The live-updates socket, driven.
 *
 * Nothing here fails loudly. A socket that stops reconnecting just means the group page quietly
 * goes stale; one that keeps reconnecting after you have navigated away leaks a socket per
 * navigation and keeps calling a callback for a screen that is gone. Both look like nothing at all
 * until somebody notices balances that will not move.
 *
 * The four rules worth holding: it retries after a drop, it stops retrying once unmounted, it only
 * acts on messages about its own group, and a malformed frame is ignored rather than thrown.
 */

class FakeSocket {
  static instances: FakeSocket[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readonly close = vi.fn();
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  /** Deliver a frame the way the room would. */
  deliver(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  /** The socket dropped, for whatever reason. */
  drop(): void {
    this.onclose?.();
  }
}

const sockets = () => FakeSocket.instances;
const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1]!;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the address it dials', () => {
  it('is the group’s own room, on the websocket scheme', () => {
    renderHook(() => useGroupRealtime('g1', vi.fn()));
    expect(latest().url).toBe('ws://localhost:3000/owewell/groups/g1/ws');
  });

  // In production the app is served over https, where an insecure socket is simply blocked.
  it('upgrades to the secure scheme on a secure origin', () => {
    const real = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...real, origin: 'https://owewell.example', protocol: 'https:' },
    });
    renderHook(() => useGroupRealtime('g1', vi.fn()));
    expect(latest().url).toBe('wss://owewell.example/owewell/groups/g1/ws');
    Object.defineProperty(window, 'location', { configurable: true, value: real });
  });

  it('opens nothing at all without a group', () => {
    renderHook(() => useGroupRealtime('', vi.fn()));
    expect(sockets()).toHaveLength(0);
  });
});

describe('what it acts on', () => {
  it('runs the callback when its own group changes', () => {
    const onChange = vi.fn();
    renderHook(() => useGroupRealtime('g1', onChange));
    latest().deliver({ type: 'group:changed', groupId: 'g1' });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // A frame about a different group, or of a different type, is not this screen's business.
  it.each([
    ['another group', { type: 'group:changed', groupId: 'g2' }],
    ['another type', { type: 'presence', groupId: 'g1' }],
    ['no type at all', { groupId: 'g1' }],
  ])('ignores a frame about %s', (_case, frame) => {
    const onChange = vi.fn();
    renderHook(() => useGroupRealtime('g1', onChange));
    latest().deliver(frame);
    expect(onChange).not.toHaveBeenCalled();
  });

  // A frame that is not JSON must not take the page down with it.
  it('shrugs off a malformed frame', () => {
    const onChange = vi.fn();
    renderHook(() => useGroupRealtime('g1', onChange));
    expect(() => latest().deliver('not json {')).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });

  /*
   * The callback is read through a ref, so a parent that re-renders with a new closure does not
   * tear down and re-dial the socket — it just gets used on the next frame.
   */
  it('uses the newest callback without redialling', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useGroupRealtime('g1', cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    expect(sockets()).toHaveLength(1);
    latest().deliver({ type: 'group:changed', groupId: 'g1' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('when the connection drops', () => {
  it('dials again after a pause', () => {
    renderHook(() => useGroupRealtime('g1', vi.fn()));
    latest().drop();
    expect(sockets()).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(sockets()).toHaveLength(2);
  });

  it('the replacement is live', () => {
    const onChange = vi.fn();
    renderHook(() => useGroupRealtime('g1', onChange));
    latest().drop();
    vi.advanceTimersByTime(2000);
    latest().deliver({ type: 'group:changed', groupId: 'g1' });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  /*
   * The leak. Without the stopped flag, every drop after unmount dials again forever, so a session
   * that visits five groups ends up holding five reconnecting sockets and calling five dead
   * callbacks.
   */
  it('stops dialling once the screen is gone', () => {
    const { unmount } = renderHook(() => useGroupRealtime('g1', vi.fn()));
    const first = latest();
    unmount();
    expect(first.close).toHaveBeenCalled();
    first.drop();
    vi.advanceTimersByTime(10_000);
    expect(sockets()).toHaveLength(1);
  });

  // Dropped, then navigated away before the retry fired: the pending timer has to be cancelled too.
  it('cancels a retry that was already pending', () => {
    const { unmount } = renderHook(() => useGroupRealtime('g1', vi.fn()));
    latest().drop();
    unmount();
    vi.advanceTimersByTime(10_000);
    expect(sockets()).toHaveLength(1);
  });
});

describe('moving between groups', () => {
  it('closes the old room and opens the new one', () => {
    const { rerender } = renderHook(({ id }) => useGroupRealtime(id, vi.fn()), {
      initialProps: { id: 'g1' },
    });
    const first = latest();
    rerender({ id: 'g2' });
    expect(first.close).toHaveBeenCalled();
    expect(sockets()).toHaveLength(2);
    expect(latest().url).toContain('/groups/g2/ws');
  });
});
