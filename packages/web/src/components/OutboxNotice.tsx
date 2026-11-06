import { loginUrl } from '@aidenjang/auth-client';
import { formatMoney } from '@owewell/shared';
import { Link } from 'react-router-dom';
import { AUTH_ORIGIN } from '../lib/api';
import { isCreate, isEdit, type QueuedWrite } from '../lib/outbox';
import type { OutboxSync } from '../lib/useOutboxSync';

export function OutboxNotice({
  count,
  waitingMessage,
  sync,
  onCorrect,
}: {
  count: number;
  waitingMessage: string;
  sync: OutboxSync;
  onCorrect?: (entry: QueuedWrite) => void;
}) {
  const { paused, syncing, retry, unassigned, recover, failed, retryFailed, discardFailed } = sync;
  if (!count && !unassigned && !failed.length) return null;
  const message =
    paused === 'sign-in'
      ? 'Sign in again to send your waiting changes.'
      : paused === 'temporary'
        ? 'Sync is temporarily unavailable. Your changes are still on this device.'
        : paused === 'storage'
          ? 'Sync paused. Check browser storage before retrying.'
          : paused === 'conflict'
            ? 'An offline edit needs your decision. Your version is still on this device.'
            : paused === 'delete-conflict'
              ? 'An expense changed before its queued deletion could sync.'
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
            {syncing
              ? 'Syncing…'
              : paused === 'conflict'
                ? 'Review edit'
                : paused === 'delete-conflict'
                  ? 'Review deletion'
                  : 'Retry sync'}
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
      {failed.length > 0 && (
        <details className="w-full">
          <summary className="tap min-h-11 cursor-pointer py-2.5 font-medium text-ink">
            {failed.length === 1
              ? 'One saved change needs attention'
              : `${failed.length} saved changes need attention`}
          </summary>
          <ul className="divide-y divide-line">
            {failed.map((entry) => (
              <li key={entry.clientId} className="py-2 [overflow-wrap:anywhere]">
                <p className="font-medium text-ink">
                  {entry.description}
                  {'amountCents' in entry ? ` · ${formatMoney(entry.amountCents)}` : ''}
                </p>
                <p>{entry.failure} This change is still on this device.</p>
                <div className="mt-1 flex flex-wrap gap-x-4">
                  {onCorrect ? (
                    (isCreate(entry) || isEdit(entry)) && (
                      <button
                        type="button"
                        onClick={() => onCorrect(entry)}
                        className="tap inline-flex min-h-11 items-center font-medium text-accent underline"
                      >
                        Edit saved expense
                      </button>
                    )
                  ) : (
                    <Link
                      className="tap inline-flex min-h-11 items-center font-medium text-accent underline"
                      to={`/groups/${entry.groupId}`}
                    >
                      Open group
                    </Link>
                  )}
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={() => void retryFailed(entry)}
                    className="tap inline-flex min-h-11 items-center font-medium text-accent underline disabled:opacity-60"
                  >
                    Retry this change
                  </button>
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={() => void discardFailed(entry)}
                    className="tap inline-flex min-h-11 items-center underline disabled:opacity-60"
                  >
                    Discard…
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
