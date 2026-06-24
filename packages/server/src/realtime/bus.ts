import { EventEmitter } from 'node:events';

export const GROUP_CHANGED = 'group:changed';

/**
 * Process-local event bus. Mutations emit "this group changed" and the realtime
 * plugin relays it to subscribed sockets. Single-process only; a multi-instance
 * deployment would swap this for Redis pub/sub.
 */
export const realtimeBus = new EventEmitter();

export function emitGroupChanged(groupId: string): void {
  realtimeBus.emit(GROUP_CHANGED, groupId);
}
