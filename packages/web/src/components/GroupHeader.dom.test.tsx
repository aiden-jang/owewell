import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { GroupSummary } from '../lib/groups';

/**
 * The group toolbar, driven.
 *
 * Two rules run through all of it. Owner-only actions have to be genuinely absent rather than
 * disabled, because a rename or a delete offered to somebody who cannot do it is a promise the
 * server will break. And the menu has to get out of the way once it has been used: it floats over a
 * page that the action it just fired is about to change.
 */

const group = (id: string, name: string): GroupSummary => ({
  id, name, createdAt: '2026-08-01T00:00:00.000Z', archived: false, currency: 'USD',
  memberCount: 3, netCents: 0, totalUnsettledCents: 0, totalSpentCents: 0,
  lastActivityAt: '2026-08-10T00:00:00.000Z', isOwner: true,
});
const GROUPS = [group('g1', 'Tahoe'), group('g2', 'Big Sur')];

const handlers = {
  onSwitchGroup: vi.fn(),
  onRename: vi.fn<(name: string) => Promise<void>>(),
  onChangeCurrency: vi.fn<(code: string) => Promise<void>>(),
  onToggleArchive: vi.fn<() => Promise<void>>(),
  onDelete: vi.fn<() => Promise<void>>(),
  onInvite: vi.fn(),
  onExport: vi.fn(),
};

async function open(over: Record<string, unknown> = {}) {
  const { GroupHeader } = await import('./GroupHeader');
  render(
    <MemoryRouter>
      <GroupHeader
        groupId="g1"
        groupName="Tahoe"
        archived={false}
        currency="USD"
        isOwner
        groups={GROUPS}
        {...handlers}
        {...over}
      />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Group options' }));
const menu = () => screen.getByRole('menu');

beforeEach(() => {
  for (const fn of Object.values(handlers)) fn.mockReset();
  handlers.onRename.mockResolvedValue(undefined);
  handlers.onChangeCurrency.mockResolvedValue(undefined);
  handlers.onToggleArchive.mockResolvedValue(undefined);
  handlers.onDelete.mockResolvedValue(undefined);
});

describe('what a member is offered', () => {
  it('gets the things that are theirs to do', async () => {
    const user = await open({ isOwner: false });
    await openMenu(user);
    expect(within(menu()).getByRole('menuitem', { name: /Export activity/ })).toBeInTheDocument();
    // Archiving hides the group from your own list only, so it is not an owner action.
    expect(within(menu()).getByRole('menuitem', { name: /Archive/ })).toBeInTheDocument();
  });

  /*
   * Absent, not disabled. A greyed-out Delete still says "this is a thing that could happen here",
   * and the server would refuse it anyway.
   */
  it('is not shown the ones the server would refuse', async () => {
    const user = await open({ isOwner: false });
    await openMenu(user);
    expect(within(menu()).queryByRole('menuitem', { name: /Rename/ })).not.toBeInTheDocument();
    expect(within(menu()).queryByRole('menuitem', { name: /Delete group/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Group currency')).not.toBeInTheDocument();
  });

  it('shows an owner all of them', async () => {
    const user = await open();
    await openMenu(user);
    expect(within(menu()).getByRole('menuitem', { name: /Rename/ })).toBeInTheDocument();
    expect(within(menu()).getByRole('menuitem', { name: /Delete group/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Group currency')).toBeInTheDocument();
  });
});

describe('the menu getting out of the way', () => {
  /*
   * Only Export and Currency used to close it. Archiving or deleting left it hanging open over a
   * page that had already changed underneath it.
   */
  it.each([
    ['Export activity', 'onExport'],
    ['Archive (hide from my list)', 'onToggleArchive'],
    ['Delete group', 'onDelete'],
  ] as const)('closes after %s', async (label, handler) => {
    const user = await open();
    await openMenu(user);
    await user.click(within(menu()).getByRole('menuitem', { name: label }));
    expect(handlers[handler]).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on a click anywhere else', async () => {
    const user = await open();
    await openMenu(user);
    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('renaming', () => {
  it('opens an editor seeded with the current name', async () => {
    const user = await open();
    await openMenu(user);
    await user.click(within(menu()).getByRole('menuitem', { name: /Rename/ }));
    expect(screen.getByLabelText('Group name')).toHaveValue('Tahoe');
  });

  it('sends the trimmed name and closes', async () => {
    const user = await open();
    await openMenu(user);
    await user.click(within(menu()).getByRole('menuitem', { name: /Rename/ }));
    await user.clear(screen.getByLabelText('Group name'));
    await user.type(screen.getByLabelText('Group name'), '  Tahoe 2026  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(handlers.onRename).toHaveBeenCalledWith('Tahoe 2026');
    expect(screen.queryByLabelText('Group name')).not.toBeInTheDocument();
  });

  it('sends nothing for an empty name', async () => {
    const user = await open();
    await openMenu(user);
    await user.click(within(menu()).getByRole('menuitem', { name: /Rename/ }));
    await user.clear(screen.getByLabelText('Group name'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(handlers.onRename).not.toHaveBeenCalled();
  });

  // The page reports the failure; the editor's job is not to lose what was typed.
  it('keeps the editor open when the rename fails', async () => {
    handlers.onRename.mockRejectedValue(new Error('taken'));
    const user = await open();
    await openMenu(user);
    await user.click(within(menu()).getByRole('menuitem', { name: /Rename/ }));
    await user.type(screen.getByLabelText('Group name'), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('Group name')).toHaveValue('Tahoe!');
  });

  it('abandons the edit on cancel', async () => {
    const user = await open();
    await openMenu(user);
    await user.click(within(menu()).getByRole('menuitem', { name: /Rename/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: /Tahoe/ })).toBeInTheDocument();
  });
});

describe('the group switcher', () => {
  it('moves you to another group', async () => {
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Switch group'), 'g2');
    expect(handlers.onSwitchGroup).toHaveBeenCalledWith('g2');
  });

  it('stays hidden when there is nowhere to switch to', async () => {
    await open({ groups: [GROUPS[0]!] });
    expect(screen.queryByLabelText('Switch group')).not.toBeInTheDocument();
  });

  // Mid-load, or on a group you reached by link, the list may not contain this one yet — and a select
  // whose value is not among its options renders as somebody else's group.
  it('stays hidden until the list contains the group you are on', async () => {
    await open({ groups: [group('g2', 'Big Sur'), group('g3', 'Flat')] });
    expect(screen.queryByLabelText('Switch group')).not.toBeInTheDocument();
  });
});

describe('the rest of the bar', () => {
  it('offers the invite', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Invite people to this group' }));
    expect(handlers.onInvite).toHaveBeenCalled();
  });

  /*
   * Reaching for the currency used to close the menu out from under you.
   *
   * It is the one menu item you interact with rather than press, and opening its select is a click
   * like any other, so the close-on-outside-click listener fired and took the picker with it. There
   * was no way to change a group's currency at all.
   */
  it('survives being reached for, then closes once a currency is picked', async () => {
    const user = await open();
    await openMenu(user);
    await user.click(screen.getByLabelText('Group currency'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Group currency'), 'EUR');
    expect(handlers.onChangeCurrency).toHaveBeenCalledWith('EUR');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('says when the group is archived, and offers the way back', async () => {
    const user = await open({ archived: true });
    expect(screen.getByText('archived')).toBeInTheDocument();
    await openMenu(user);
    expect(within(menu()).getByRole('menuitem', { name: /Unarchive/ })).toBeInTheDocument();
  });
});
