import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** The read-only share link, copy feedback and owner controls for replacing or revoking it. */
export function InviteLink({
  link,
  copied,
  onCopy,
  headline,
  hint,
  isOwner,
  onRotate,
  onRevoke,
}: {
  link: string;
  copied: boolean;
  onCopy: () => void;
  headline?: string;
  hint?: string;
  /** Only the owner can break a link everybody already has. The server enforces it too. */
  isOwner?: boolean;
  onRotate?: () => void;
  onRevoke?: () => void;
}): ReactNode {
  return (
    <div className="mt-4 rounded-2xl border border-accent/25 bg-accent-soft p-4">
      <p className="text-sm font-medium">{headline ?? 'Group invite link'}</p>
      <p className="mt-0.5 text-xs text-muted">
        {hint ??
          'Anyone with this link can view the group. To edit, choose your existing name and sign in. This connects that spot and its balances to your account.'}
      </p>
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          aria-label="Share link"
          className="min-w-0 flex-1 rounded-xl border border-line bg-field px-3 py-2.5 text-sm text-muted outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={onCopy}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-medium transition ${
            copied ? 'bg-pos/15 text-pos' : 'bg-surface2 hover:bg-surface2/70'
          }`}
        >
          <Icon name={copied ? 'check' : 'copy'} size={15} />{' '}
          <span role="status">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      {/* Owner controls stay next to the link they invalidate; membership survives either action. */}
      {isOwner && (onRotate || onRevoke) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {onRotate && (
            <button
              type="button"
              onClick={onRotate}
              className="tap font-medium text-muted transition hover:text-ink hover:underline"
            >
              New link
            </button>
          )}
          {onRevoke && (
            <button
              type="button"
              onClick={onRevoke}
              className="tap font-medium text-muted transition hover:text-neg hover:underline"
            >
              Turn off
            </button>
          )}
          <span className="text-faint">Either one stops every copy already sent.</span>
        </div>
      )}
    </div>
  );
}
