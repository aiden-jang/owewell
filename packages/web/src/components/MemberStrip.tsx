import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import type { GroupMember } from '../lib/groups';

/*
 * Who is in this group, above the money.
 *
 * The roster lives in a sheet behind the ⋯ menu, which answers "who is in this group" only if you
 * already thought to look there. That is the wrong shape for the question: it is the one thing about
 * a group you check at a glance and almost never edit, so it should be visible and the editing
 * should be the thing behind a tap.
 *
 * Faces rather than names, because five names is a list and five faces is one object. Overlapping
 * with a ring in the card colour so the stack reads as a stack rather than as five things that
 * failed to lay out.
 */

/** Past this the stack stops being a glance and starts being a queue. The rest become "+n". */
const SHOWN = 5;

export function MemberStrip({
  members,
  onOpen,
  centered = false,
}: {
  members: GroupMember[];
  onOpen: () => void;
  /** Follows the hero, which centres itself once there is no figure to line up on. */
  centered?: boolean;
}): ReactNode {
  const shown = members.slice(0, SHOWN);
  const rest = members.length - shown.length;
  const label = members.length === 1 ? 'Just you' : `${members.length} people`;

  return (
    <div className={`mb-4 flex ${centered ? 'justify-center' : ''}`}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${members.length} ${members.length === 1 ? 'member' : 'members'}. Open the member list.`}
        className="group inline-flex items-center gap-2 rounded-full border border-line bg-surface2/50 py-1 pl-1 pr-2.5 transition hover:border-line-strong hover:bg-surface2"
      >
        <span className="flex -space-x-1.5">
          {shown.map((member) => (
            // ring-card, not ring-surface2: the ring separates the faces from each other, and the
            // pill it sits on is translucent, so the colour behind them is the hero's.
            <span key={member.userId} className="rounded-full ring-2 ring-card">
              <Avatar name={member.displayName} size="xs" />
            </span>
          ))}
          {rest > 0 && (
            <span className="tnum inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface2 text-2xs font-semibold text-muted ring-2 ring-card">
              +{rest}
            </span>
          )}
        </span>
        <span className="text-xs font-medium text-muted transition group-hover:text-ink">{label}</span>
        <Icon name="chevron-right" size={13} />
      </button>
    </div>
  );
}
