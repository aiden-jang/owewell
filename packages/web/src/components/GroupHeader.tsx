import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CURRENCIES } from '@owewell/shared';
import { Icon } from './Icon';
import type { GroupSummary } from '../lib/groups';

/*
 * The name of the group, and everything you can do to the group itself.
 *
 * Three pieces of state live here and nowhere else: whether the options menu is open, whether the
 * name is being edited, and the draft of that name. Everything the menu items actually DO belongs
 * to the page, because all of it is a write against the group — so this is a toolbar with a lot of
 * callbacks, which is the honest shape of a toolbar.
 */

export function GroupHeader({
  groupId,
  groupName,
  archived,
  currency,
  isOwner,
  groups,
  onSwitchGroup,
  onRename,
  onChangeCurrency,
  onToggleArchive,
  onDelete,
  onInvite,
  onExport,
  onOpenMembers,
}: {
  groupId: string;
  groupName: string;
  archived: boolean;
  currency: string;
  isOwner: boolean;
  /** For the switcher. Fewer than two, or none matching groupId, and it stays hidden. */
  groups: GroupSummary[];
  onSwitchGroup: (id: string) => void;
  onRename: (name: string) => Promise<void>;
  onChangeCurrency: (code: string) => Promise<void>;
  onToggleArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
  onInvite: () => void;
  onExport: () => void;
  /** Who is in the group is roster management, so it lives here rather than beside the spending. */
  onOpenMembers: () => void;
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  /*
   * Every menu item closes the menu, whether or not what it started succeeded.
   *
   * Only two of them used to, which meant archiving or deleting left the menu hanging open over a
   * page that had already changed underneath it. Closing is about the menu having been used, not
   * about the outcome, so it happens on the way out rather than on the way back.
   */
  const runAndClose = (action: () => void | Promise<void>) => (): void => {
    setMenuOpen(false);
    void action();
  };

  async function saveRename(): Promise<void> {
    const name = draftName.trim();
    if (!name) return;
    try {
      await onRename(name);
      setRenaming(false);
    } catch {
      // The page reports it. Keep the field open so what was typed is not thrown away.
    }
  }

  return (
    <>
          <div className="flex items-center justify-between gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-sm font-medium text-muted transition hover:text-ink"
            >
              <Icon name="arrow-left" size={16} /> Your groups
            </Link>
            {groups.length > 1 && groups.some((g) => g.id === groupId) && (
              <select
                value={groupId}
                onChange={(e) => {
                  if (e.target.value !== groupId) onSwitchGroup(e.target.value);
                }}
                aria-label="Switch group"
                className="max-w-[55%] truncate rounded-full border border-line bg-field px-3 py-1.5 text-sm text-muted outline-none transition hover:text-ink focus:border-accent"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {renaming ? (
            <div className="mt-3 flex gap-2">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                aria-label="Group name"
                className="flex-1 rounded-xl border border-line bg-field px-3 py-2 font-display text-2xl outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => void saveRename()}
                className="btn-gradient rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="rounded-full border border-line px-4 py-2 text-sm font-medium text-muted transition hover:bg-surface2"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between gap-3">
              <h1 className="flex min-w-0 items-center gap-2 font-display text-3xl font-semibold tracking-tight">
                <span className="truncate">{groupName}</span>
                {archived && (
                  <span className="shrink-0 rounded-full bg-surface2 px-2 py-0.5 text-xs font-medium text-muted">
                    archived
                  </span>
                )}
              </h1>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={onInvite}
                  aria-label="Invite people to this group"
                  className="inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-full border border-line-strong bg-surface2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent sm:w-auto sm:px-3.5"
                >
                  {/* Icon-only on phones, where the header competes with a long group name for width. The
                      aria-label above carries the meaning either way, so nothing is lost to a screen
                      reader. */}
                  <Icon name="share" size={15} />
                  <span className="hidden sm:inline">Invite</span>
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen((v) => !v);
                    }}
                    aria-label="Group options"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    className="grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-surface2 hover:text-ink"
                  >
                    <Icon name="more" size={18} />
                  </button>
                  {menuOpen && (
                    <div
                      role="menu"
                      className="surface absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-2xl border border-line py-1 shadow-xl shadow-black/40"
                    >
                      <button
                        role="menuitem"
                        type="button"
                        onClick={runAndClose(onOpenMembers)}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-surface2"
                      >
                        <Icon name="user-plus" size={15} /> Members
                      </button>
                      <button
                        role="menuitem"
                        type="button"
                        onClick={runAndClose(onExport)}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-surface2"
                      >
                        <Icon name="receipt" size={15} /> Export activity
                      </button>
                      {isOwner && (
                        <button
                          role="menuitem"
                          type="button"
                          onClick={runAndClose(() => {
                            setDraftName(groupName);
                            setRenaming(true);
                          })}
                          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-surface2"
                        >
                          <Icon name="pencil" size={15} /> Rename
                        </button>
                      )}
                      {isOwner && (
                        <label
                          /*
                           * The only menu item you interact with rather than press.
                           *
                           * Everything else here fires and the menu closes behind it, which is what
                           * the document listener above is for. Opening this select is a click too,
                           * so without stopping it the menu vanished the instant you reached for the
                           * currency and there was no way to change it at all.
                           */
                          onClick={(e) => e.stopPropagation()}
                          className="flex w-full items-center justify-between gap-2.5 px-4 py-2.5 text-left text-sm"
                        >
                          <span className="flex items-center gap-2.5">
                            <Icon name="wallet" size={15} /> Currency
                          </span>
                          <select
                            value={currency}
                            onChange={(e) => runAndClose(() => onChangeCurrency(e.target.value))()}
                            aria-label="Group currency"
                            className="rounded-lg border border-line bg-field px-2 py-1 text-sm outline-none focus:border-accent"
                          >
                            {CURRENCIES.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.code}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {/* Per-member: archiving hides the group from your own list only. */}
                      <button
                        role="menuitem"
                        type="button"
                        onClick={runAndClose(onToggleArchive)}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-surface2"
                      >
                        <Icon name={archived ? 'undo' : 'archive'} size={15} />{' '}
                        {archived ? 'Unarchive (show in my list)' : 'Archive (hide from my list)'}
                      </button>
                      {isOwner && (
                        <button
                          role="menuitem"
                          type="button"
                          onClick={runAndClose(onDelete)}
                          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neg transition hover:bg-surface2"
                        >
                          <Icon name="trash" size={15} /> Delete group
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
    </>
  );
}
