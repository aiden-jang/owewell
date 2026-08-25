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
  groupId: string;
  /** Enough to name it in a message without unpacking the payload. */
  description: string;
  queuedAt: number;
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

function read(): QueuedWrite[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as QueuedWrite[]) : [];
  } catch {
    // An unreadable queue is an empty one. Throwing here would break every render of the group page.
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
 * Worth retrying, or not: a dropped connection succeeds later, a 422 never will. A TypeError from
 * `fetch` is the only signal the browser gives for the first.
 */
export function isOffline(err: unknown): boolean {
  return err instanceof TypeError || !navigator.onLine;
}

export interface FlushResult {
  sent: number;
  /** Writes the server refused outright. Dropped from the queue; the caller has to say so. */
  rejected: { entry: QueuedWrite; message: string }[];
  /** Edits the row moved out from under. Dropped too, but they need a question, not a message. */
  conflicted: QueuedEdit[];
}

/**
 * Oldest first. Stops at the first network failure — if one request can't reach the server, neither
 * can the next. A rejection is different: that entry can never succeed, so drop it and report it.
 */
export async function flush(
  send: (entry: QueuedWrite) => Promise<unknown>,
  groupId?: string,
): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, rejected: [], conflicted: [] };
  for (const entry of queued(groupId)) {
    try {
      await send(entry);
      drop(entry.clientId);
      result.sent += 1;
    } catch (err) {
      if (isOffline(err)) return result;
      drop(entry.clientId);
      if (isConflict(err) && isEdit(entry)) {
        result.conflicted.push(entry);
        continue;
      }
      result.rejected.push({
        entry,
        message: err instanceof Error ? err.message : 'The server would not take it.',
      });
    }
  }
  return result;
}
