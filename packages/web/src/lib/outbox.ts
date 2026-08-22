import type { CreateExpensePayload, CreateItemizedPayload } from '@owewell/core';

/*
 * Writes that were typed while the network was not there.
 *
 * The app gets used in restaurants, which is exactly where a phone has one bar and a captive portal.
 * Losing a six-person itemized receipt to a failed POST is the worst thing this app can do short of
 * getting the arithmetic wrong, so a create that cannot reach the server is kept here and sent later.
 *
 * Scope is deliberately narrow: creates only. Edits and deletes of a queued expense would need a
 * local id that becomes a server id, and offline settlements would let two people record the same
 * payment twice with nothing to reconcile them. Both are real features; neither is this one.
 *
 * Not the Background Sync API, which would be the textbook answer: Safari does not implement it, and
 * a bill splitter that only works offline on Android is not offline support.
 */

const KEY = 'owewell:outbox';

export type QueuedKind = 'expense' | 'itemized';

export interface QueuedWrite {
  /** Also the server's idempotency key: a replay of this is recognised, not duplicated. */
  clientId: string;
  groupId: string;
  kind: QueuedKind;
  /** Enough to render a row for it without unpacking the payload. */
  description: string;
  amountCents: number;
  queuedAt: number;
  payload: CreateExpensePayload | CreateItemizedPayload;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): QueuedWrite[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as QueuedWrite[]) : [];
  } catch {
    // Storage disabled, or somebody hand-edited it. An unreadable queue is an empty one; the
    // alternative is throwing on every render of the group page.
    return [];
  }
}

function write(entries: QueuedWrite[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Full or blocked. Nothing useful to do here: the caller already has the data on screen.
  }
  for (const fn of listeners) fn();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Everything still waiting, oldest first, so replay preserves the order they were typed in. */
export function queued(groupId?: string): QueuedWrite[] {
  const all = read().sort((a, b) => a.queuedAt - b.queuedAt);
  return groupId ? all.filter((e) => e.groupId === groupId) : all;
}

export function enqueue(entry: QueuedWrite): void {
  write([...read().filter((e) => e.clientId !== entry.clientId), entry]);
}

export function drop(clientId: string): void {
  write(read().filter((e) => e.clientId !== clientId));
}

/**
 * A failure the network caused, rather than one the request did.
 *
 * The distinction decides whether a write is worth keeping: a dropped connection is temporary and
 * the same request will succeed later, while a 422 will be a 422 forever. `fetch` rejects with a
 * TypeError for the former, which is the only signal the browser gives us.
 */
export function isOffline(err: unknown): boolean {
  return err instanceof TypeError || !navigator.onLine;
}

export interface FlushResult {
  sent: number;
  /** Writes the server refused outright. Dropped from the queue; the caller has to say so. */
  rejected: { entry: QueuedWrite; message: string }[];
}

/**
 * Try the queue, oldest first.
 *
 * Stops at the first network failure rather than marching through the rest: if one request cannot
 * reach the server, neither can the next, and hammering a dead connection just burns battery. A
 * server *rejection* is different — that entry can never succeed, so it is dropped and reported.
 */
export async function flush(
  send: (entry: QueuedWrite) => Promise<unknown>,
  groupId?: string,
): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, rejected: [] };
  for (const entry of queued(groupId)) {
    try {
      await send(entry);
      drop(entry.clientId);
      result.sent += 1;
    } catch (err) {
      if (isOffline(err)) return result;
      drop(entry.clientId);
      result.rejected.push({
        entry,
        message: err instanceof Error ? err.message : 'The server would not take it.',
      });
    }
  }
  return result;
}
