import { useState, type FormEvent, type ReactNode } from 'react';
import type { Balance, GroupMember } from '../lib/groups';
import { formatMoney as fmt, type MoneyFormatter } from '@owewell/shared';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { useToast } from './Toast';

// Handlers throw; each editor owns the placement of its failure message.

export interface PaymentHandles {
  venmoHandle: string;
  cashappCashtag: string;
  paypalHandle: string;
}

/** What a member's net position reads as on their row. Empty before the group has any activity. */
function balanceLabel(
  netCents: number,
  hasActivity: boolean,
  fmt: MoneyFormatter,
): { text: string; tone: string } {
  // No expenses yet means nobody is settled OR unsettled — there's just nothing owed. Don't label
  // a brand-new member "settled up"; that only makes sense once there's been something to settle.
  if (!hasActivity) return { text: '', tone: 'text-muted' };
  if (netCents === 0) return { text: 'settled up', tone: 'text-muted' };
  const amount = fmt(Math.abs(netCents));
  return netCents > 0
    ? { text: `is owed ${amount}`, tone: 'text-pos' }
    : { text: `owes ${amount}`, tone: 'text-neg' };
}

/** One of the small pill buttons under a row, once its actions are open. */
function RowAction({
  onClick,
  label,
  icon,
  danger = false,
}: {
  onClick: () => void;
  label: string;
  icon: 'pencil' | 'wallet' | 'x';
  danger?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tap inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium transition hover:border-line-strong hover:bg-surface2 ${
        danger ? 'text-neg' : 'text-muted hover:text-ink'
      }`}
    >
      <Icon name={icon} size={13} /> {label}
    </button>
  );
}

export function MembersPanel({
  members,
  balances,
  currentUserId,
  isOwner,
  hasActivity,
  paymentsRecorded,
  onRename,
  onSaveHandles,
  onAdd,
  onRemove,
}: {
  members: GroupMember[];
  balances: Balance[];
  currentUserId: string | undefined;
  isOwner: boolean;
  /** Anything on the ledger at all. Before that, "settled up" would be a lie by omission. */
  hasActivity: boolean;
  /** A payment exists, which freezes the roster: removing re-splits and would invalidate it. */
  paymentsRecorded: boolean;
  onRename: (memberId: string, name: string) => Promise<void>;
  onSaveHandles: (memberId: string, handles: PaymentHandles) => Promise<void>;
  onAdd: (name: string) => Promise<void>;
  /** Owns the confirmation, because the re-split it warns about is the page's business. */
  onRemove: (memberId: string, netCents: number) => Promise<void>;
}): ReactNode {
  const toast = useToast();
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [actionsId, setActionsId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [handlesId, setHandlesId] = useState<string | null>(null);
  const [venmo, setVenmo] = useState('');
  const [cashapp, setCashapp] = useState('');
  const [paypal, setPaypal] = useState('');
  const [busy, setBusy] = useState(false);

  const netOf = Object.fromEntries(balances.map((b) => [b.userId, b.netCents]));
  const balanceOf = Object.fromEntries(balances.map((b) => [b.userId, b]));

  async function saveName(memberId: string): Promise<void> {
    const name = renameDraft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onRename(memberId, name);
      setRenamingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not rename them.');
    } finally {
      setBusy(false);
    }
  }

  function startRename(member: GroupMember): void {
    setActionsId(null);
    setRenamingId(member.userId);
    setRenameDraft(member.displayName);
  }

  function startHandles(member: GroupMember): void {
    setActionsId(null);
    setHandlesId(member.userId);
    setVenmo(member.venmoHandle ?? '');
    setCashapp(member.cashappCashtag ?? '');
    setPaypal(member.paypalHandle ?? '');
  }

  async function saveHandles(memberId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await onSaveHandles(memberId, { venmoHandle: venmo, cashappCashtag: cashapp, paypalHandle: paypal });
      setHandlesId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save payment handles.');
    } finally {
      setBusy(false);
    }
  }

  async function addMember(event: FormEvent): Promise<void> {
    event.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setAddError(null);
    try {
      await onAdd(name);
      setNewName('');
    } catch (err) {
      // Inline rather than a toast: the field that caused it is still on screen, and "already in
      // this group" is something you fix by retyping.
      setAddError(err instanceof Error ? err.message : 'Could not add them.');
    } finally {
      setBusy(false);
    }
  }

  return (
    /* No heading: the sheet's own title already says "Members". */
    <section>
      <div>
        {/* Same treatment as the ledger: one panel, hairline rows. A roster is a list of the
              same kind of thing, and three floating cards said otherwise. */}
        <ul className="panel">
          {members.map((member) => {
            const label = balanceLabel(netOf[member.userId] ?? 0, hasActivity, fmt);
            const bal = balanceOf[member.userId];
            const isSelf = member.userId === currentUserId;
            const canRename = member.isPlaceholder;
            // Your own handles are yours to set and everyone else's are theirs, except
            // placeholders, who have nobody to set them.
            const canSetHandles = isSelf || member.isPlaceholder;
            // The owner can remove a non-owner member only before any payment is recorded
            // (removal re-splits expenses, which would break a logged settlement). There's no
            // "leave" — to get a group off your list you archive it.
            const canRemove = isOwner && !isSelf && member.role !== 'OWNER' && !paymentsRecorded;
            const hasActions = canRename || canSetHandles || canRemove;
            const open = actionsId === member.userId;
            const detail =
              bal && (bal.paidCents > 0 || bal.owedCents > 0)
                ? `paid ${fmt(bal.paidCents)} · share ${fmt(bal.owedCents)}`
                : '';
            return (
              <li key={member.userId} className="flex items-center justify-between gap-3 px-4 py-3">
                {renamingId === member.userId ? (
                  <span className="flex w-full items-center gap-2">
                    <input
                      disabled={busy}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void saveName(member.userId);
                        }
                        if (event.key === 'Escape' && !busy) setRenamingId(null);
                      }}
                      maxLength={80}
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      autoFocus
                      aria-label="Member name"
                      className="min-w-0 flex-1 rounded-lg border border-line bg-field px-2.5 py-1.5 outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      disabled={busy || !renameDraft.trim()}
                      onClick={() => void saveName(member.userId)}
                      className="text-sm font-medium text-accent"
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRenamingId(null)}
                      className="text-sm text-muted"
                    >
                      Cancel
                    </button>
                  </span>
                ) : handlesId === member.userId ? (
                  <span className="flex w-full flex-col gap-2">
                    <span className="text-xs font-medium text-muted">
                      {member.displayName}&rsquo;s payment handles
                    </span>
                    <input
                      disabled={busy}
                      value={venmo}
                      onChange={(e) => setVenmo(e.target.value)}
                      placeholder="Venmo username"
                      aria-label="Venmo username"
                      autoFocus
                      className="rounded-lg border border-line bg-field px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                    />
                    <input
                      disabled={busy}
                      value={cashapp}
                      onChange={(e) => setCashapp(e.target.value)}
                      placeholder="Cash App $cashtag"
                      aria-label="Cash App cashtag"
                      className="rounded-lg border border-line bg-field px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                    />
                    <input
                      disabled={busy}
                      value={paypal}
                      onChange={(e) => setPaypal(e.target.value)}
                      placeholder="PayPal.me username"
                      aria-label="PayPal.me username"
                      className="rounded-lg border border-line bg-field px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                    />
                    <span className="flex gap-3 pt-0.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void saveHandles(member.userId)}
                        className="text-sm font-medium text-accent"
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setHandlesId(null)}
                        className="text-sm text-muted"
                      >
                        Cancel
                      </button>
                    </span>
                  </span>
                ) : (
                  <span className="flex min-w-0 flex-1 items-start gap-3">
                    <Avatar name={member.displayName} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {/*
                       * Name on the first line, money on the second. The figures are shrink-0, so
                       * sharing a row means the name is the only thing that can give — an
                       * eight-person roster on a 375px phone rendered "Tomas" as "T…".
                       *
                       * "owner" stays on the name line: it says who someone is, not what they owe.
                       */}
                      <span className="flex items-baseline gap-1.5">
                        <span className="min-w-0 break-words [overflow-wrap:anywhere] font-medium">
                          {member.displayName}
                        </span>
                        {member.role === 'OWNER' && (
                          <span className="shrink-0 text-2xs text-faint">owner</span>
                        )}
                      </span>
                      {label.text && (
                        /*
                         * The position only. There is no room for "paid X · share Y" as well — it
                         * clips, and wrapping pushes the add-someone field off screen. It moves into
                         * the open row below, where it also stops competing with the fronting card.
                         */
                        <span className={`tnum break-words text-xs font-medium ${label.tone}`}>
                          {label.text}
                        </span>
                      )}
                      {open && (
                        /*
                         * All roster editing in one place per member. Bare icons that appear on some
                         * rows and not others are a puzzle, not an affordance. Inline rather than a
                         * popup: this list scrolls inside a sheet, so a menu on the last row has
                         * nowhere to go.
                         */
                        <span className="flex flex-col gap-2 pt-2">
                          {detail && <span className="tnum text-xs text-faint">{detail}</span>}
                          {/* Wide vertical gaps: the pills are 30px tall, so stacked their 44px hit
                              areas would overlap, with Remove at the bottom. */}
                          <span className="flex flex-wrap gap-x-2 gap-y-3.5">
                            {canRename && (
                              <RowAction icon="pencil" label="Rename" onClick={() => startRename(member)} />
                            )}
                            {canSetHandles && (
                              <RowAction
                                icon="wallet"
                                label="Payment handles"
                                onClick={() => startHandles(member)}
                              />
                            )}
                            {canRemove && (
                              <RowAction
                                icon="x"
                                label="Remove"
                                danger
                                onClick={() => {
                                  setActionsId(null);
                                  void onRemove(member.userId, netOf[member.userId] ?? 0);
                                }}
                              />
                            )}
                          </span>
                        </span>
                      )}
                    </span>
                    {hasActions && (
                      <button
                        type="button"
                        onClick={() => setActionsId(open ? null : member.userId)}
                        aria-label={`Options for ${member.displayName}`}
                        aria-expanded={open}
                        className={`tap grid h-8 w-8 shrink-0 place-items-center rounded-full transition hover:bg-surface2 hover:text-ink ${
                          open ? 'bg-surface2 text-ink' : 'text-faint'
                        }`}
                      >
                        <Icon name="more" size={16} />
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <form onSubmit={(e) => void addMember(e)} className="mt-3 flex gap-2">
          <input
            type="text"
            disabled={busy}
            aria-label="Member name to add"
            aria-invalid={!!addError}
            aria-describedby={addError ? 'member-add-error' : undefined}
            maxLength={80}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add someone by name"
            className="min-w-0 flex-1 rounded-xl border border-line bg-field px-3.5 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-4 py-2.5 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
          >
            <Icon name="user-plus" size={16} /> {busy ? 'Saving…' : 'Add'}
          </button>
        </form>
        {addError && (
          <p id="member-add-error" role="alert" className="mt-2 text-sm font-medium text-neg">
            {addError}
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          Added someone by name? Use <span className="font-medium text-ink">Invite</span> up top for a link
          they can use to sign in and claim their spot.
        </p>
        {isOwner && paymentsRecorded && (
          <p className="mt-1 text-xs text-faint">
            Members can&rsquo;t be removed once a payment has been recorded.
          </p>
        )}
      </div>
    </section>
  );
}
