import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { ReceiptFace } from './ReceiptFace';

// Empty collections and failed reads have distinct presentations.

export function EmptyState({
  tone,
  icon,
  title,
  body,
  action,
  titleAs = 'h2',
}: {
  tone: 'invite' | 'problem';
  icon: IconName;
  title: string;
  body?: ReactNode;
  /** A button or a link. Optional: a dead end with nothing to offer says so by offering nothing. */
  action?: ReactNode;
  titleAs?: 'h1' | 'h2';
}): ReactNode {
  const invite = tone === 'invite';
  const Heading = titleAs;
  return (
    <div
      className={`empty-state rounded-3xl p-10 text-center ${invite ? 'surface' : 'border border-dashed border-line'}`}
    >
      {invite ? (
        <div className="empty-receipt">
          <ReceiptFace />
        </div>
      ) : (
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-muted">
          <Icon name={icon} size={22} />
        </div>
      )}
      <Heading className="mt-4 text-lg font-medium text-ink">{title}</Heading>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
