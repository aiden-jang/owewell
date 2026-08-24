import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Balance, GroupMember } from '../lib/groups';

/**
 * The member list, driven.
 *
 * Two things in here are permissions rather than presentation, and both are the kind that get
 * noticed only when they are wrong: who is offered the remove button, and whether the roster is
 * still editable once a payment exists. Removing someone re-splits their share, so doing it after a
 * settlement is logged would leave a recorded payment that no longer matches any debt.
 *
 * The third is where a failure appears. A failed add belongs under the field you just typed in; a
 * failed rename has no field left on screen by then, so it goes to a toast. That split is the whole
 * reason the page's handlers throw instead of handling their own errors.
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
const BOB = member({ userId: 'b', displayName: 'Bob', email: null, isPlaceholder: true, venmoHandle: 'bobby' });
const CARA = member({ userId: 'c', displayName: 'Cara' });

const balance = (userId: string, displayName: string, netCents: number, paidCents = 0, owedCents = 0): Balance =>
  ({ userId, displayName, netCents, paidCents, owedCents });

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
  // Collapsed by default for a group that already has people.
  const toggle = screen.queryByRole('button', { name: /Members/ });
  if (toggle && !screen.queryByPlaceholderText('Add someone by name')) await user.click(toggle);
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

const rowFor = (name: string) => screen.getByText(name, { selector: 'span.truncate' }).closest('li')!;

beforeEach(() => {
  for (const fn of [onRename, onSaveHandles, onAdd, onRemove]) fn.mockReset().mockResolvedValue(undefined);
  toastStub.error.mockReset();
});

describe('whether the list starts open', () => {
  it('stays collapsed for a group that already has people', async () => {
    await renderPanel();
    expect(screen.queryByPlaceholderText('Add someone by name')).not.toBeInTheDocument();
  });

  /*
   * A group of one has exactly one useful next step, and it is inside this panel. Leaving it folded
   * away puts the only thing worth doing behind a click that gives no hint of what is under it.
   */
  it('opens itself when the group still needs someone', async () => {
    await renderPanel({ members: [ALICE], balances: [BALANCES[0]] });
    expect(screen.getByPlaceholderText('Add someone by name')).toBeInTheDocument();
  });
});

describe('who can be removed', () => {
  it('offers the owner a way to remove another member', async () => {
    await open();
    await expect(within(rowFor('Cara')).findByRole('button', { name: 'Remove Cara' })).resolves.toBeInTheDocument();
  });

  it('never offers it for the owner or for yourself', async () => {
    await open();
    expect(within(rowFor('Alice')).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('offers a plain member nothing to remove', async () => {
    await open({ isOwner: false, currentUserId: 'c' });
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  /*
   * The one that matters. Removing re-splits the leaver's share across everyone else, which moves
   * balances a recorded payment was measured against — so once any payment exists the roster is
   * frozen, and the panel says why rather than just hiding the button.
   */
  it('freezes the roster once a payment has been recorded', async () => {
    await open({ paymentsRecorded: true });
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText(/can’t be removed once a payment has been recorded/)).toBeInTheDocument();
  });

  it('passes the net position along, because the warning depends on it', async () => {
    const user = await open();
    await user.click(within(rowFor('Cara')).getByRole('button', { name: 'Remove Cara' }));
    expect(onRemove).toHaveBeenCalledWith('c', 0);
  });
});

describe('renaming', () => {
  it('is offered for placeholders only', async () => {
    await open();
    expect(within(rowFor('Bob')).getByRole('button', { name: 'Rename Bob' })).toBeInTheDocument();
    expect(within(rowFor('Cara')).queryByRole('button', { name: /Rename/ })).not.toBeInTheDocument();
  });

  it('starts from the name they already have', async () => {
    const user = await open();
    await user.click(within(rowFor('Bob')).getByRole('button', { name: 'Rename Bob' }));
    expect(screen.getByLabelText('Member name')).toHaveValue('Bob');
  });

  it('sends the trimmed name and closes the editor', async () => {
    const user = await open();
    await user.click(within(rowFor('Bob')).getByRole('button', { name: 'Rename Bob' }));
    await user.clear(screen.getByLabelText('Member name'));
    await user.type(screen.getByLabelText('Member name'), '  Bobby  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).toHaveBeenCalledWith('b', 'Bobby');
    expect(screen.queryByLabelText('Member name')).not.toBeInTheDocument();
  });

  it('keeps the editor open and says so when it fails', async () => {
    onRename.mockRejectedValue(new Error('Name already taken.'));
    const user = await open();
    await user.click(within(rowFor('Bob')).getByRole('button', { name: 'Rename Bob' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(toastStub.error).toHaveBeenCalledWith('Name already taken.');
    expect(screen.getByLabelText('Member name')).toBeInTheDocument();
  });
});

describe('payment handles', () => {
  it('prefills from the member and sends all three', async () => {
    const user = await open();
    await user.click(within(rowFor('Bob')).getByRole('button', { name: 'Payment handles for Bob' }));
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
    await open();
    expect(within(rowFor('Alice')).getByRole('button', { name: /Payment handles/ })).toBeInTheDocument();
    expect(within(rowFor('Bob')).getByRole('button', { name: /Payment handles/ })).toBeInTheDocument();
    expect(within(rowFor('Cara')).queryByRole('button', { name: /Payment handles/ })).not.toBeInTheDocument();
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
  it('names the position and what it is made of', async () => {
    await open();
    expect(within(rowFor('Bob')).getByText('owes $30.00')).toBeInTheDocument();
    expect(within(rowFor('Alice')).getByText('is owed $40.00')).toBeInTheDocument();
    expect(within(rowFor('Cara')).getByText('paid $10.00 · share $10.00')).toBeInTheDocument();
  });

  it('calls a zero balance settled up, but only once there is something to settle', async () => {
    await open();
    expect(within(rowFor('Cara')).getByText('settled up')).toBeInTheDocument();
  });

  // A brand-new member of a brand-new group is not "settled up" — there has been nothing to settle.
  it('says nothing at all before the group has any activity', async () => {
    await open({ hasActivity: false, balances: [balance('a', 'Alice', 0), balance('b', 'Bob', 0), balance('c', 'Cara', 0)] });
    expect(screen.queryByText('settled up')).not.toBeInTheDocument();
  });
});
