import type { CreateExpensePayload, CreateItemizedPayload, RecordSettlementPayload } from '@owewell/core';
import { ApiError } from './api';

/*
 * Writes queued in localStorage when the network is missing, replayed later.
 *
 * Not the Background Sync API: Safari doesn't implement it.
 */

const KEY = 'owewell:outbox';

interface QueuedBase {
  /** Identifies this write across retries. For creates it is also the server's idempotency key. */
  clientId: string;
  ownerId?: string | undefined;
  groupId: string;
  /** Enough to name it in a message without unpacking the payload. */
  description: string;
  queuedAt: number;
  failure?: string | undefined;
}

export interface QueuedCreate extends QueuedBase {
  kind: 'expense' | 'itemized';
  amountCents: number;
  payload: CreateExpensePayload | CreateItemizedPayload;
}

/** Deleting is repeatable, so no idempotency key. A 404 on replay is success; see `isAlreadyDone`. */
export interface QueuedDelete extends QueuedBase {
  kind: 'delete';
  expenseId: string;
}

/**
 * Carries the version it was written against. Without it, an edit replayed an hour later silently
 * erases whatever happened in between.
 */
export interface QueuedEdit extends QueuedBase {
  kind: 'edit' | 'edit-itemized';
  expenseId: string;
  amountCents: number;
  payload: CreateExpensePayload | CreateItemizedPayload;
}

/** Appends rather than overwrites, so replaying it late can only duplicate — which the id prevents. */
export interface QueuedSettlement extends QueuedBase {
  kind: 'settlement';
  amountCents: number;
  payload: RecordSettlementPayload;
}

export type QueuedWrite = QueuedCreate | QueuedDelete | QueuedEdit | QueuedSettlement;

export const isSettlement = (entry: QueuedWrite): entry is QueuedSettlement => entry.kind === 'settlement';
/** Everything that appears in the feed as a row waiting to be sent. */
export const isPendingRow = (entry: QueuedWrite): entry is QueuedCreate | QueuedSettlement =>
  isCreate(entry) || isSettlement(entry);

const CREATE_KINDS = new Set(['expense', 'itemized']);
export const isCreate = (entry: QueuedWrite): entry is QueuedCreate => CREATE_KINDS.has(entry.kind);
export const isDelete = (entry: QueuedWrite): entry is QueuedDelete => entry.kind === 'delete';
export const isEdit = (entry: QueuedWrite): entry is QueuedEdit =>
  entry.kind === 'edit' || entry.kind === 'edit-itemized';

/** Not a rejection: the edit is still wanted, but a person has to choose. Ask, don't report. */
export function isConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

/** 404 means failure everywhere else. On a replayed delete it means done — stop carrying it. */
export function isAlreadyDone(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): QueuedWrite[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as QueuedWrite[]) : null;
  } catch {
    // An unreadable queue is an empty one. Throwing here would break every render of the group page.
    return null;
  }
}

function write(entries: QueuedWrite[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    return false;
  }
  for (const fn of listeners) fn();
  return true;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

/** Everything still waiting, oldest first, so replay preserves the order they were typed in. */
export function queued(groupId?: string, ownerId?: string): QueuedWrite[] {
  return (read() ?? [])
    .filter((entry) => (!groupId || entry.groupId === groupId) && (!ownerId || entry.ownerId === ownerId))
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

export function unassignedWrites(groupId?: string): QueuedWrite[] {
  return queued(groupId).filter((entry) => !entry.ownerId);
}

export function adoptWrites(ownerId: string, clientIds: Set<string>): boolean {
  const entries = read();
  return (
    entries !== null &&
    write(
      entries.map((entry) =>
        !entry.ownerId && clientIds.has(entry.clientId) ? { ...entry, ownerId } : entry,
      ),
    )
  );
}

export const OUTBOX_STORAGE_ERROR =
  'Could not keep this change on this device. Check browser storage or try again when connected.';

export function enqueue(entry: QueuedWrite): boolean {
  const entries = read();
  return entries !== null && write([...entries.filter((e) => e.clientId !== entry.clientId), entry]);
}

export function drop(clientId: string): boolean {
  const entries = read();
  return entries !== null && write(entries.filter((e) => e.clientId !== clientId));
}

export function setFailure(clientId: string, ownerId: string | undefined, failure?: string): boolean {
  const entries = read();
  return (
    entries !== null &&
    write(
      entries.map((entry) =>
        entry.clientId === clientId && entry.ownerId === ownerId ? { ...entry, failure } : entry,
      ),
    )
  );
}

/**
 * Worth retrying, or not: a dropped connection succeeds later, a 422 never will. A TypeError from
 * `fetch` is the only signal the browser gives for the first.
 */
export function isOffline(err: unknown): boolean {
  return err instanceof TypeError || !navigator.onLine;
}

export interface FlushResult {
  sent: number;
  paused?: 'sign-in' | 'temporary' | 'storage';
  /** Edits that still need a decision before they can leave the queue. */
  conflicted: QueuedEdit[];
}

export function pauseFor(error: unknown): FlushResult['paused'] {
  if (!(error instanceof ApiError)) return undefined;
  if (error.status === 401) return 'sign-in';
  if (error.status === 408 || error.status === 429 || error.status >= 500) return 'temporary';
  return undefined;
}

/**
 * Oldest first. Stops at the first network failure — if one request can't reach the server, neither
 * can the next. Keep rejected input for review and continue with the other entries.
 */
export async function flush(
  send: (entry: QueuedWrite) => Promise<unknown>,
  groupId?: string,
  ownerId?: string,
): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, conflicted: [] };
  for (const entry of queued(groupId, ownerId)) {
    if (entry.failure) continue;
    try {
      await send(entry);
    } catch (err) {
      if (isOffline(err)) return result;
      const paused = pauseFor(err);
      if (paused) return { ...result, paused };
      if (isConflict(err) && isEdit(entry)) {
        return { ...result, conflicted: [entry] };
      }
      const message = err instanceof Error ? err.message : 'The server couldn’t save this change.';
      if (!setFailure(entry.clientId, entry.ownerId, message)) {
        return { ...result, paused: 'storage' };
      }
      continue;
    }
    if (!drop(entry.clientId)) return { ...result, paused: 'storage' };
    result.sent += 1;
  }
  return result;
}
