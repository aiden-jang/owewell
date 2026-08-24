import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * The group's invite link, with a Copy button.
 *
 * Lives in its own file because GroupDetailPage renders it in two places: promoted above the balances
 * while the group still needs people, and tucked below the actions once it does not.
 */
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
          'Anyone with this link can view the group. People you added by name can sign in and claim their spot to join and edit.'}
      </p>
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          aria-label="Share link"
          className="min-w-0 flex-1 rounded-xl border border-line bg-field px-3 py-2.5 text-sm text-muted outline-none"
        />
        <button
          type="button"
          onClick={onCopy}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-medium transition ${
            copied ? 'bg-pos/15 text-pos' : 'bg-surface2 hover:bg-surface2/70'
          }`}
        >
          <Icon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/*
        * Taking the link back, which for a long time was not possible at all.
        *
        * A token was minted once and never changed, so the only way to stop a link that had been
        * forwarded on was deleting the group. These two sit under the field rather than in the ⋯
        * menu because this panel is the only place the link itself is on screen, and the decision
        * to kill it is one you make while looking at it.
        */}
      {isOwner && (onRotate || onRevoke) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {onRotate && (
            <button type="button" onClick={onRotate} className="tap font-medium text-muted transition hover:text-ink hover:underline">
              New link
            </button>
          )}
          {onRevoke && (
            <button type="button" onClick={onRevoke} className="tap font-medium text-muted transition hover:text-neg hover:underline">
              Turn off
            </button>
          )}
          <span className="text-faint">Either one stops every copy already sent.</span>
        </div>
      )}
    </div>
  );
}
