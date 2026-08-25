import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Balance, GroupMember } from '../lib/groups';

/**
 * The member list, driven. Two of these are permissions rather than presentation: who is offered
 * Remove, and whether the roster freezes once a payment exists — removing someone re-splits their
 * share, which would leave a recorded payment matching no debt.
 */

const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('./Toast', () => ({ useToast: () => toastStub }));

function member(over: Partial<GroupMember> & { userId: string; displayName: string }): GroupMember {
  return {
    email: 'someone@example.com',
    role: 'MEMBER',
    joinedAt: '2026-08-01T00:00:00.000Z',
    isPlaceholder: false,
    venmoHandle: null,
    cashappCashtag: null,
    paypalHandle: null,
    ...over,
  };
}

const ALICE = member({ userId: 'a', displayName: 'Alice', role: 'OWNER' });
const BOB = member({
  userId: 'b',
  displayName: 'Bob',
  email: null,
  isPlaceholder: true,
  venmoHandle: 'bobby',
});
const CARA = member({ userId: 'c', displayName: 'Cara' });

const balance = (
  userId: string,
  displayName: string,
  netCents: number,
  paidCents = 0,
  owedCents = 0,
): Balance => ({ userId, displayName, netCents, paidCents, owedCents });

const BALANCES = [
  balance('a', 'Alice', 4_000, 4_000, 0),
  balance('b', 'Bob', -3_000, 0, 3_000),
  balance('c', 'Cara', 0, 1_000, 1_000),
];

const onRename = vi.fn<(id: string, name: string) => Promise<void>>();
const onSaveHandles = vi.fn<(id: string, handles: unknown) => Promise<void>>();
const onAdd = vi.fn<(name: string) => Promise<void>>();
const onRemove = vi.fn<(id: string, netCents: number) => Promise<void>>();

async function open(over: Partial<Parameters<typeof renderPanel>[0]> = {}) {
  const user = userEvent.setup();
  await renderPanel(over);
  return user;
}

async function renderPanel(over: Record<string, unknown> = {}) {
  const { MembersPanel } = await import('./MembersPanel');
  render(
    <MembersPanel
      members={[ALICE, BOB, CARA]}
      balances={BALANCES}
      currentUserId="a"
      isOwner
      hasActivity
      paymentsRecorded={false}
      onRename={onRename}
      onSaveHandles={onSaveHandles}
      onAdd={onAdd}
      onRemove={onRemove}
      {...over}
    />,
  );
}

const rowFor = (name: string) =>
  screen.getByText(name, { selector: 'span.truncate.font-medium' }).closest('li')!;

/*
 * Roster editing lives behind one "Options" button per member rather than a scatter of bare icons.
 * Every test that reaches Rename, Payment handles or Remove opens that first, which doubles as the
 * assertion that the button is offered at all: a member you may do nothing to has no Options
 * button, so this throws rather than quietly finding nothing.
 */
async function openActions(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(rowFor(name)).getByRole('button', { name: `Options for ${name}` }));
  return within(rowFor(name));
}

beforeEach(() => {
  for (const fn of [onRename, onSaveHandles, onAdd, onRemove]) fn.mockReset().mockResolvedValue(undefined);
  toastStub.error.mockReset();
});

describe('what it shows', () => {
  /*
   * No collapse. This renders inside a sheet somebody opened by choosing "Members", so folding the
   * list away behind a toggle would hide the thing they just asked for, under a heading that
   * already says what it is.
   */
  it('shows the roster straight away', async () => {
    await renderPanel();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Add someone by name')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Members/ })).not.toBeInTheDocument();
  });
});

describe('who can be removed', () => {
  it('offers the owner a way to remove another member', async () => {
    const user = await open();
    const row = await openActions(user, 'Cara');
    expect(row.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('never offers it for the owner or for yourself', async () => {
    const user = await open();
    const row = await openActions(user, 'Alice');
    expect(row.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  // A plain member gets their own payment handles and nothing else. Someone they may do nothing to
  // has no Options button at all, rather than one that opens onto an empty menu.
  it('offers a plain member their own handles and no way to remove anyone', async () => {
    const user = await open({ isOwner: false, currentUserId: 'c' });
    const self = await openActions(user, 'Cara');
    expect(self.getByRole('button', { name: 'Payment handles' })).toBeInTheDocument();
    expect(self.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Options for Alice' })).not.toBeInTheDocument();
  });

  /*
   * The one that matters. Removing re-splits the leaver's share across everyone else, which moves
   * balances a recorded payment was measured against — so once any payment exists the roster is
   * frozen, and the panel says why rather than just hiding the button.
   */
  it('freezes the roster once a payment has been recorded', async () => {
    const user = await open({ paymentsRecorded: true });
    const row = await openActions(user, 'Bob');
    expect(row.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.getByText(/can’t be removed once a payment has been recorded/)).toBeInTheDocument();
  });

  it('passes the net position along, because the warning depends on it', async () => {
    const user = await open();
    const row = await openActions(user, 'Cara');
    await user.click(row.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('c', 0);
  });
});

describe('renaming', () => {
  it('is offered for placeholders only', async () => {
    const user = await open();
    expect((await openActions(user, 'Bob')).getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(
      (await openActions(user, 'Cara')).queryByRole('button', { name: 'Rename' }),
    ).not.toBeInTheDocument();
  });

  it('starts from the name they already have', async () => {
    const user = await open();
    await user.click((await openActions(user, 'Bob')).getByRole('button', { name: 'Rename' }));
    expect(screen.getByLabelText('Member name')).toHaveValue('Bob');
  });

  it('sends the trimmed name and closes the editor', async () => {
    const user = await open();
    await user.click((await openActions(user, 'Bob')).getByRole('button', { name: 'Rename' }));
    await user.clear(screen.getByLabelText('Member name'));
    await user.type(screen.getByLabelText('Member name'), '  Bobby  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).toHaveBeenCalledWith('b', 'Bobby');
    expect(screen.queryByLabelText('Member name')).not.toBeInTheDocument();
  });

  it('keeps the editor open and says so when it fails', async () => {
    onRename.mockRejectedValue(new Error('Name already taken.'));
    const user = await open();
    await user.click((await openActions(user, 'Bob')).getByRole('button', { name: 'Rename' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(toastStub.error).toHaveBeenCalledWith('Name already taken.');
    expect(screen.getByLabelText('Member name')).toBeInTheDocument();
  });
});

describe('payment handles', () => {
  it('prefills from the member and sends all three', async () => {
    const user = await open();
    await user.click((await openActions(user, 'Bob')).getByRole('button', { name: 'Payment handles' }));
    expect(screen.getByLabelText('Venmo username')).toHaveValue('bobby');

    await user.type(screen.getByLabelText('Cash App cashtag'), 'bobbucks');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSaveHandles).toHaveBeenCalledWith('b', {
      venmoHandle: 'bobby',
      cashappCashtag: 'bobbucks',
      paypalHandle: '',
    });
  });

  // Your own handles are yours to set; everyone else's are theirs, except placeholders who have
  // nobody to set them.
  it('is offered for yourself and for placeholders, not for other real members', async () => {
    const user = await open();
    expect(
      (await openActions(user, 'Alice')).getByRole('button', { name: 'Payment handles' }),
    ).toBeInTheDocument();
    expect(
      (await openActions(user, 'Bob')).getByRole('button', { name: 'Payment handles' }),
    ).toBeInTheDocument();
    expect(
      (await openActions(user, 'Cara')).queryByRole('button', { name: 'Payment handles' }),
    ).not.toBeInTheDocument();
  });
});

describe('adding someone', () => {
  it('clears the field once it lands', async () => {
    const user = await open();
    const field = screen.getByPlaceholderText('Add someone by name');
    await user.type(field, 'Dana');
    await user.click(screen.getByRole('button', { name: /Add/ }));
    expect(onAdd).toHaveBeenCalledWith('Dana');
    expect(field).toHaveValue('');
  });

  // Typing a name and hitting return is the natural way to add several people in a row.
  it('submits on Enter, not just on the button', async () => {
    const user = await open();
    await user.type(screen.getByPlaceholderText('Add someone by name'), 'Dana{Enter}');
    expect(onAdd).toHaveBeenCalledWith('Dana');
  });

  it('says nothing and sends nothing for an empty name', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Add/ }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  // Inline, not a toast: the field that caused it is right there and the fix is to retype.
  it('puts the failure under the field and keeps what was typed', async () => {
    onAdd.mockRejectedValue(new Error('Someone by that name is already here.'));
    const user = await open();
    await user.type(screen.getByPlaceholderText('Add someone by name'), 'Bob');
    await user.click(screen.getByRole('button', { name: /Add/ }));
    expect(screen.getByText('Someone by that name is already here.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Add someone by name')).toHaveValue('Bob');
    expect(toastStub.error).not.toHaveBeenCalled();
  });
});

describe('what each row says about the money', () => {
  it('names the position on the row itself', async () => {
    await open();
    expect(within(rowFor('Bob')).getByText('owes $30.00')).toBeInTheDocument();
    expect(within(rowFor('Alice')).getByText('is owed $40.00')).toBeInTheDocument();
  });

  /*
   * The breakdown waits until you open the row.
   *
   * Position, breakdown and name could not share the width: an eight-person roster on a 375px phone
   * was rendering "Tomas" as "T…". The name is the one thing a member list exists to show, so it
   * keeps the first line and "paid X · share Y" moves down — where it also stops competing with the
   * fronting breakdown, which answers the same question with a bar.
   */
  it('keeps the breakdown out of the row until the row is opened', async () => {
    const user = await open();
    expect(screen.queryByText('paid $10.00 · share $10.00')).not.toBeInTheDocument();
    const row = await openActions(user, 'Cara');
    expect(row.getByText('paid $10.00 · share $10.00')).toBeInTheDocument();
  });

  it('shows no breakdown for someone who has neither paid nor owed anything', async () => {
    const user = await open({
      balances: [balance('a', 'Alice', 0), balance('b', 'Bob', 0), balance('c', 'Cara', 0)],
    });
    const row = await openActions(user, 'Cara');
    expect(row.queryByText(/paid \$/)).not.toBeInTheDocument();
  });

  it('calls a zero balance settled up, but only once there is something to settle', async () => {
    await open();
    expect(within(rowFor('Cara')).getByText('settled up')).toBeInTheDocument();
  });

  // A brand-new member of a brand-new group is not "settled up" — there has been nothing to settle.
  it('says nothing at all before the group has any activity', async () => {
    await open({
      hasActivity: false,
      balances: [balance('a', 'Alice', 0), balance('b', 'Bob', 0), balance('c', 'Cara', 0)],
    });
    expect(screen.queryByText('settled up')).not.toBeInTheDocument();
  });
});
