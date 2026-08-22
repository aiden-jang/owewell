import { type ReactNode } from 'react';
import { Money, correctionLine, type CorrectionField } from '@owewell/shared';
import { categoryMeta, type Expense, type GroupMember } from '@owewell/core';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

/*
 * What one expense actually says, once you tap it.
 *
 * The row in the feed can only carry a total and a payer, which is the one thing nobody argues about.
 * The arguments are all downstream of it: how much is mine, why is mine more than yours, who was even
 * on this. So this sheet leads with the reader's own share and then shows every share underneath it,
 * in the units the payer typed rather than reverse-engineered dollars.
 */

const SPLIT_METHOD_LABELS: Record<string, string> = {
  EQUAL: 'Split equally',
  EXACT: 'Exact amounts',
  PERCENT: 'Split by percent',
  SHARES: 'Split by shares',
  ITEMIZED: 'Split by receipt',
};

function fullDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** The number the payer actually typed for this person, in their own units. Null for EQUAL. */
function inputNote(method: string, value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (method === 'SHARES') return value === 1 ? '1 share' : `${value} shares`;
  if (method === 'PERCENT') return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 1)}%`;
  return null;
}

function Row({
  left,
  right,
  muted,
}: {
  left: ReactNode;
  right: ReactNode;
  muted?: boolean;
}): ReactNode {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className={`min-w-0 text-sm ${muted ? 'text-muted' : ''}`}>{left}</div>
      <span className={`tnum shrink-0 text-sm ${muted ? 'text-muted' : 'font-medium'}`}>{right}</span>
    </li>
  );
}

export function ExpenseDetail({
  expense,
  members,
  viewerId,
  locked,
  archived,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  expense: Expense;
  members: GroupMember[];
  viewerId: string | undefined;
  /** A payment has been recorded, so the ledger no longer takes edits. */
  locked: boolean;
  archived: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}): ReactNode {
  const nameOf = (id: string): string => members.find((m) => m.userId === id)?.displayName ?? 'Someone';
  const category = categoryMeta(expense.category);
  const itemized = expense.splitMethod === 'ITEMIZED';
  const payers = itemized && expense.items?.length
    ? [...new Set(expense.items.map((i) => i.payerId ?? expense.payerId))]
    : [expense.payerId];
  const myShare = expense.splits.find((s) => s.userId === viewerId);
  const iPaid = payers.includes(viewerId ?? '');
  const items = expense.items ?? [];
  const itemsTotal = items.reduce((sum, i) => sum + i.amountCents, 0);

  return (
    <div>
      <div className="text-center">
        <p className="font-display text-4xl font-semibold tracking-tight tnum">
          {Money.fromCents(expense.amountCents).format()}
        </p>
        <p className="mt-1 text-sm text-muted">
          <span aria-hidden className="mr-1">
            {category.emoji}
          </span>
          {category.label} · {fullDate(expense.date)}
        </p>
      </div>

      {/* The reader's own number, said before the table they'd otherwise scan to find it. */}
      {myShare && (
        <p className="mt-4 rounded-2xl bg-surface2 px-4 py-3 text-center text-sm">
          {iPaid ? (
            <>
              You paid, and your share is{' '}
              <span className="tnum font-semibold">{Money.fromCents(myShare.owedCents).format()}</span>
            </>
          ) : (
            <>
              Your share is{' '}
              <span className="tnum font-semibold">{Money.fromCents(myShare.owedCents).format()}</span>
            </>
          )}
        </p>
      )}

      <div className="mt-5">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Avatar name={nameOf(payers[0] ?? expense.payerId)} size="sm" />
          <span>
            {payers.length === 1
              ? `${nameOf(payers[0]!)} paid`
              : `${payers.map(nameOf).join(', ')} paid`}
          </span>
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-faint">
          {SPLIT_METHOD_LABELS[expense.splitMethod] ?? 'Split'} · {expense.splits.length}{' '}
          {expense.splits.length === 1 ? 'person' : 'people'}
        </p>
        <ul aria-label="Every share" className="mt-1 divide-y divide-line">
          {expense.splits.map((split) => {
            const note = inputNote(expense.splitMethod, split.inputValue);
            return (
              <Row
                key={split.userId}
                left={
                  <span className="flex items-center gap-2">
                    <Avatar name={nameOf(split.userId)} size="sm" />
                    <span className="truncate">
                      {split.userId === viewerId ? 'You' : nameOf(split.userId)}
                      {payers.includes(split.userId) && <span className="text-muted"> · paid</span>}
                      {note && <span className="text-faint"> · {note}</span>}
                    </span>
                  </span>
                }
                right={Money.fromCents(split.owedCents).format()}
              />
            );
          })}
        </ul>
      </div>

      {itemized && items.length > 0 && (
        <div className="mt-5 border-t border-line pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Receipt</p>
          <ul aria-label="Receipt lines" className="mt-1 divide-y divide-line">
            {items.map((item, i) => (
              <Row
                key={`${item.name}-${i}`}
                left={
                  <span className="block truncate">
                    {item.name}
                    <span className="text-faint">
                      {' · '}
                      {item.participantIds.length === expense.splits.length
                        ? 'shared'
                        : item.participantIds.map(nameOf).join(', ')}
                    </span>
                  </span>
                }
                right={Money.fromCents(item.amountCents).format()}
              />
            ))}
            <Row left="Items" right={Money.fromCents(itemsTotal).format()} muted />
            {/* Tax and tip ride along with each item's share, so they're shown but not itemised again. */}
            <Row left="Tax" right={Money.fromCents(expense.taxCents ?? 0).format()} muted />
            <Row left="Tip" right={Money.fromCents(expense.tipCents ?? 0).format()} muted />
          </ul>
        </div>
      )}

      {expense.lastEdit && (
        <p className="mt-4 text-xs text-faint">
          {correctionLine(
            expense.lastEdit.fields as CorrectionField[],
            nameOf(expense.lastEdit.byId),
            Money.fromCents(expense.lastEdit.formerAmountCents).format(),
          )}
        </p>
      )}

      {!archived && (
        <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={onDuplicate}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-medium transition hover:bg-surface2"
          >
            <Icon name="copy" size={15} /> Duplicate
          </button>
          {!locked && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-medium transition hover:bg-surface2"
              >
                <Icon name="pencil" size={15} /> Edit
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-neg transition hover:bg-neg/10"
              >
                <Icon name="trash" size={15} /> Delete
              </button>
            </>
          )}
        </div>
      )}

      {locked && !archived && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-faint">
          <Icon name="undo" size={13} />
          A payment&rsquo;s been recorded, so this is locked. Undo it to edit or remove this.
        </p>
      )}
    </div>
  );
}
