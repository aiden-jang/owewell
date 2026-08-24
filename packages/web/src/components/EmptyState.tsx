import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/*
 * The two things a page says when it has no list to show, and why they must not look alike.
 *
 * They did. Every one of these was a dashed box with a grey icon in a grey square, so "No groups
 * yet" — the first screen a new account ever sees — was pixel-for-pixel the same object as
 * "Couldn't load your groups" directly above it in the same file. One of those is an invitation and
 * the other is a failure, and a person landing on the first should not have to read the sentence to
 * work out which they got.
 *
 *   invite   there is nothing here yet, and that is the normal beginning of things.
 *            A solid card in the accent, because it is part of the app rather than a hole in it.
 *   problem  something did not load, or is gone. Dashed and grey: the conventional reading of a
 *            dashed border is "missing", which is exactly right here and exactly wrong above.
 *
 * One component rather than a convention, because a convention is a thing you remember and this is
 * a thing that was already forgotten six times.
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
      className={`rounded-3xl p-10 text-center ${
        invite ? 'surface' : 'border border-dashed border-line'
      }`}
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
