import type { CreateExpensePayload, CreateItemizedPayload, RecordSettlementPayload } from '@owewell/core';
import { ApiError } from './api';

/*
 * Writes that were typed while the network was not there.
 *
 * The app gets used in restaurants, which is exactly where a phone has one bar and a captive portal.
 * Losing a six-person itemized receipt to a failed POST is the worst thing this app can do short of
 * getting the arithmetic wrong, so a create that cannot reach the server is kept here and sent later.
 *
 * Creates, deletes, edits and recorded payments — every write the group page makes.
 *
 * Each is here on its own terms. A create carries an idempotency key so a replay is recognised. A
 * delete needs none, being repeatable by nature. An edit carries the version it was based on, so one
 * that would erase somebody else's change is refused and comes back as a question rather than quietly
 * winning. A payment is a fact about the past — "Bob handed Alice $30" stays true however much the
 * balances moved while it waited — so it only needs the key that stops it being logged twice.
 *
 * Not the Background Sync API, which would be the textbook answer: Safari does not implement it, and
 * a bill splitter that only works offline on Android is not offline support.
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

/**
 * A delete that could not be sent.
 *
 * Safe to queue for the same reason it needed no idempotency key: deleting is naturally repeatable,
 * and an expense that is already gone is the outcome this was asking for. Which is also why the
 * caller has to treat a 404 on replay as success rather than as a rejection — see `isAlreadyDone`.
 */
export interface QueuedDelete extends QueuedBase {
  kind: 'delete';
  expenseId: string;
}

/**
 * An edit that could not be sent.
 *
 * Carries the version it was written against, so the server can refuse it if the row moved on while
 * this sat in the queue. That refusal is the whole point: an edit replayed an hour later would
 * otherwise erase whatever happened in between without anybody being told.
 */
export interface QueuedEdit extends QueuedBase {
  kind: 'edit' | 'edit-itemized';
  expenseId: string;
  amountCents: number;
  payload: CreateExpensePayload | CreateItemizedPayload;
}

/**
 * A recorded payment that could not be sent.
 *
 * The safest of the four to replay late, because it appends rather than overwrites: nothing it lands
 * on can be wrong, only duplicated, and the client id handles that.
 */
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

/**
 * A replayed edit landing on a row that has since changed.
 *
 * Distinct from a plain rejection: the change is still wanted, it just cannot be applied blindly. The
 * caller has to ask a person, which is why this leaves the queue and comes back as a conflict rather
 * than an error message.
 */
export function isConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

/**
 * A replayed delete landing on something already deleted.
 *
 * The server answers 404, which everywhere else means "this failed". Here it means the queue can
 * stop carrying it: somebody else deleted it, or an earlier attempt got through before the
 * connection dropped and the browser never heard the answer.
 */
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
  /** Edits the row moved out from under. Dropped too, but they need a question, not a message. */
  conflicted: QueuedEdit[];
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
