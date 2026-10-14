import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
  isOwner,
  groups,
  onSwitchGroup,
  onRename,
  onToggleArchive,
  onDelete,
  onInvite,
  onExport,
  onOpenMembers,
}: {
  groupId: string;
  groupName: string;
  archived: boolean;
  isOwner: boolean;
  /** For the switcher. Fewer than two, or none matching groupId, and it stays hidden. */
  groups: GroupSummary[];
  onSwitchGroup: (id: string) => void;
  onRename: (name: string) => Promise<void>;
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
  const [saving, setSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  /*
   * Every menu item closes the menu, whether or not what it started succeeded. Closing is about the
   * menu having been used, not about the outcome — so it happens on the way out, not on the way back.
   */
  const runAndClose = (action: () => void | Promise<void>) => (): void => {
    setMenuOpen(false);
    triggerRef.current?.focus();
    void action();
  };

  async function saveRename(): Promise<void> {
    const name = draftName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await onRename(name);
      setRenaming(false);
    } catch {
      // The page reports it. Keep the field open so what was typed is not thrown away.
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/"
          className="tap inline-flex items-center gap-1 text-sm font-medium text-muted transition hover:text-ink"
        >
          <Icon name="arrow-left" size={16} /> Your groups
        </Link>
        {groups.length > 1 && groups.some((g) => g.id === groupId) && (
          // WebKit's native selected label can overflow even when the select's box fits.
          <div className="min-w-0 max-w-[55%] overflow-hidden rounded-full">
            <select
              value={groupId}
              onChange={(e) => {
                if (e.target.value !== groupId) onSwitchGroup(e.target.value);
              }}
              aria-label="Switch group"
              className="block w-full min-w-0 truncate rounded-full border border-line bg-field px-3 py-1.5 text-sm text-muted outline-none transition hover:text-ink focus:border-accent"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {renaming ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveRename();
          }}
          className="mt-3 flex flex-wrap gap-2"
        >
          <input
            autoFocus
            disabled={saving}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !saving) setRenaming(false);
            }}
            maxLength={80}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            aria-label="Group name"
            className="min-w-0 basis-full sm:basis-0 flex-1 rounded-xl border border-line bg-field px-3 py-2 font-display text-2xl outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={saving || !draftName.trim()}
            className="btn-gradient rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setRenaming(false)}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-muted transition hover:bg-surface2"
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="mt-3 flex items-start justify-between gap-3">
          <h1 className="flex min-w-0 flex-1 flex-wrap items-center gap-2 font-display text-3xl font-semibold tracking-tight">
            <span className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">{groupName}</span>
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
                ref={triggerRef}
                aria-label="Group options"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="tap grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-surface2 hover:text-ink"
              >
                <Icon name="more" size={18} />
              </button>
              {menuOpen && (
                <div
                  ref={menuRef}
                  role="menu"
                  aria-label="Group options"
                  onKeyDown={(event) => {
                    const items = [
                      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]'),
                    ];
                    const index = items.indexOf(document.activeElement as HTMLButtonElement);
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setMenuOpen(false);
                      triggerRef.current?.focus();
                    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                      event.preventDefault();
                      const next =
                        event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? items.length - 1
                            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                      items[next]?.focus();
                    } else if (event.key === 'Tab') setMenuOpen(false);
                  }}
                  className="surface absolute right-0 z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line py-1 shadow-xl shadow-black/40"
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
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left border-t border-line text-sm text-neg transition hover:bg-surface2"
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
