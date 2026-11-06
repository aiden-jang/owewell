import { loginUrl } from '@aidenjang/auth-client';
import { AUTH_ORIGIN } from '../lib/api';
import type { OutboxSync } from '../lib/useOutboxSync';

export function OutboxNotice({
  count,
  waitingMessage,
  sync,
}: {
  count: number;
  waitingMessage: string;
  sync: OutboxSync;
}) {
  const { paused, syncing, retry, unassigned, recover } = sync;
  if (!count && !unassigned) return null;
  const message =
    paused === 'sign-in'
      ? 'Sign in again to send your waiting changes.'
      : paused === 'temporary'
        ? 'Sync is temporarily unavailable. Your changes are still on this device.'
        : paused === 'storage'
          ? 'Sync paused. Check browser storage before retrying.'
          : waitingMessage;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl border border-dashed border-line-strong px-3 py-2 text-sm text-muted">
      {count > 0 && <p role="status">{message}</p>}
      {count > 0 &&
        (paused === 'sign-in' ? (
          <a
            href={loginUrl(AUTH_ORIGIN, window.location.href)}
            className="font-medium text-accent underline underline-offset-4"
          >
            Sign in again
          </a>
        ) : (
          <button
            type="button"
            disabled={syncing}
            onClick={() => void retry()}
            className="font-medium text-accent underline underline-offset-4 disabled:opacity-60"
          >
            {syncing ? 'Syncing…' : 'Retry sync'}
          </button>
        ))}
      {unassigned > 0 && (
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <p>
            {unassigned === 1 ? 'One older change needs review.' : `${unassigned} older changes need review.`}
          </p>
          <button
            type="button"
            onClick={() => void recover()}
            disabled={syncing}
            className="font-medium text-accent underline underline-offset-4 disabled:opacity-60"
          >
            Review saved changes
          </button>
        </div>
      )}
    </div>
  );
}
