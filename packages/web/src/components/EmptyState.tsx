import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/*
 * The two things a page says when it has no list to show, and why they must not look alike.
 *
 *   invite   nothing here yet, which is the normal beginning of things. A solid card in the accent,
 *            because it is part of the app rather than a hole in it.
 *   problem  something did not load, or is gone. Dashed and grey, which reads as "missing".
 *
 * "No groups yet" and "Couldn't load your groups" were the same dashed grey box, so the first screen
 * a new account saw was pixel-for-pixel a failure. One component rather than a convention, because a
 * convention is a thing you remember and this one was forgotten six times.
 */

export function EmptyState({
  tone,
  icon,
  title,
  body,
  action,
}: {
  tone: 'invite' | 'problem';
  icon: IconName;
  title: string;
  body?: ReactNode;
  /** A button or a link. Optional: a dead end with nothing to offer says so by offering nothing. */
  action?: ReactNode;
}): ReactNode {
  const invite = tone === 'invite';
  return (
    <div
      className={`rounded-3xl p-10 text-center ${invite ? 'surface' : 'border border-dashed border-line'}`}
    >
      <div
        className={`mx-auto grid h-12 w-12 place-items-center rounded-2xl ${
          invite ? 'bg-accent-soft text-accent' : 'bg-surface2 text-muted'
        }`}
      >
        <Icon name={icon} size={22} />
      </div>
      <p className="mt-4 text-lg font-medium text-ink">{title}</p>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
