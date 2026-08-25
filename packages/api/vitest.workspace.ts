/*
 * Two projects, because one setting has to differ.
 *
 * The D1 tests rely on isolated storage: each starts from the post-migration snapshot and rolls its
 * own writes back. The realtime tests cannot use it — a Durable Object holding an accepted
 * WebSocket cannot be snapshotted, and the pool fails with "Isolated storage failed" rather than
 * anything naming the cause. Closing the sockets first does not help; the incompatibility is with
 * hibernatable sockets existing at all.
 *
 * So realtime runs unisolated. It touches no D1, and each test addresses its own room by a distinct
 * group id, so there is nothing to leak between them.
 */
export default ['./vitest.config.ts', './vitest.realtime.config.ts'];
