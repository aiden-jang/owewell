import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Balance, GroupDetail, GroupMember } from '../lib/groups';
import type { SuggestedPayment } from '../lib/settlements';

/**
 * The settle-up panel, driven.
 *
 * This came out of a 2,600-line page where none of it could be reached without signing in, so the
 * behaviour worth pinning down had never been checked by anything but a person clicking. Most of it
 * is about the payment method, which is chosen in one place and used in another: a select at the
 * top, a set of pay links per row, and a Mark paid button that has to send whichever of the two
 * spoke last. Getting that wrong logs a Venmo transfer as cash, which is silent and permanent.
 */

const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('./Toast', () => ({ useToast: () => toastStub }));
// Audio has nothing to say in jsdom, and its absence should not be what fails a test.

function member(over: Partial<GroupMember> & { userId: string; displayName: string }): GroupMember {
  return {
    email: null,
    role: 'MEMBER',
    joinedAt: '2026-08-01T00:00:00.000Z',
    isPlaceholder: false,
    venmoHandle: null,
    cashappCashtag: null,
    paypalHandle: null,
    ...over,
  };
}

const ALICE = member({ userId: 'a', displayName: 'Alice', venmoHandle: 'alice' });
const BOB = member({ userId: 'b', displayName: 'Bob' });
const CARA = member({ userId: 'c', displayName: 'Cara' });

const GROUP: GroupDetail = {
  id: 'g1',
  name: 'Tahoe',
  createdById: 'a',
  createdAt: '2026-08-01T00:00:00.000Z',
  archived: false,
  members: [ALICE, BOB, CARA],
};

const balance = (userId: string, displayName: string, netCents: number): Balance => ({
  userId,
  displayName,
  netCents,
  paidCents: 0,
  owedCents: 0,
});

// Bob owes Alice $30, Cara owes Alice $10. Paying Alice off clears Bob outright.
const BOB_PAYS: SuggestedPayment = { fromUserId: 'b', fromName: 'Bob', toUserId: 'a', toName: 'Alice', amountCents: 3_000 };
const CARA_PAYS: SuggestedPayment = { fromUserId: 'c', fromName: 'Cara', toUserId: 'a', toName: 'Alice', amountCents: 1_000 };
const BALANCES = [balance('a', 'Alice', 4_000), balance('b', 'Bob', -3_000), balance('c', 'Cara', -1_000)];

const markPaid = vi.fn<(payment: SuggestedPayment, method: string) => Promise<boolean>>();

async function open(suggested: SuggestedPayment[] = [BOB_PAYS, CARA_PAYS]) {
  const { SettleUpPanel } = await import('./SettleUpPanel');
  render(
    <SettleUpPanel
      group={GROUP}
      suggested={suggested}
      balances={BALANCES}
      settling={false}
      onMarkPaid={markPaid}
    />,
  );
  return userEvent.setup();
}

const rowFor = (name: string) => screen.getByText(name, { selector: 'span.font-medium' }).closest('li')!;
// By title, not by name: the button's own text is what these tests are checking, so it cannot also
// be how they find it.
const markPaidButton = (name: string) => within(rowFor(name)).getByTitle(new RegExp(`Record ${name}`));

beforeEach(() => {
  markPaid.mockReset().mockResolvedValue(true);
});

describe('the method a payment gets logged as', () => {
  it('is whatever the select says', async () => {
    const user = await open([BOB_PAYS]);
    await user.selectOptions(screen.getByLabelText('Payment method'), 'zelle');
    await user.click(markPaidButton('Bob'));
    expect(markPaid).toHaveBeenCalledWith(BOB_PAYS, 'zelle');
  });

  /*
   * The reason the select and the links are not independent controls.
   *
   * Opening Venmo is the strongest statement anyone makes about how they are paying, and it happens
   * seconds before they come back and press Mark paid. Leaving the ledger on "cash" because that is
   * the default would record the wrong thing every single time a pay link is used.
   */
  it('follows the pay link that was just opened', async () => {
    const user = await open([BOB_PAYS]);
    await user.click(within(rowFor('Bob')).getByRole('link', { name: 'Venmo' }));
    await user.click(markPaidButton('Bob'));
    expect(markPaid).toHaveBeenCalledWith(BOB_PAYS, 'venmo');
  });
});

describe('the row after a pay link is opened', () => {
  it('asks for confirmation that the money actually moved', async () => {
    const user = await open([BOB_PAYS]);
    await user.click(within(rowFor('Bob')).getByRole('link', { name: 'Venmo' }));
    expect(markPaidButton('Bob')).toHaveTextContent('Sent it, mark paid');
    expect(screen.getByRole('status')).toHaveTextContent('Payment app opened');
  });

  it('goes back to normal once the payment is recorded', async () => {
    const user = await open([BOB_PAYS]);
    await user.click(within(rowFor('Bob')).getByRole('link', { name: 'Venmo' }));
    await user.click(markPaidButton('Bob'));
    expect(markPaidButton('Bob')).toHaveTextContent('Mark paid');
  });

  // A declined confirm comes back false, and the payment app is still open behind it.
  it('keeps waiting when the payment was not recorded', async () => {
    markPaid.mockResolvedValue(false);
    const user = await open([BOB_PAYS]);
    await user.click(within(rowFor('Bob')).getByRole('link', { name: 'Venmo' }));
    await user.click(markPaidButton('Bob'));
    expect(markPaidButton('Bob')).toHaveTextContent('Sent it, mark paid');
  });
});

describe('the nudge', () => {
  it('opens on the row that was clicked, not every row', async () => {
    const user = await open();
    await user.click(within(rowFor('Cara')).getByRole('button', { name: 'Nudge' }));
    expect(within(rowFor('Cara')).getByText('Make it sound like you')).toBeInTheDocument();
    expect(within(rowFor('Bob')).queryByText('Make it sound like you')).not.toBeInTheDocument();
  });

  it('rewrites the reminder when the tone changes', async () => {
    const user = await open([BOB_PAYS]);
    const row = rowFor('Bob');
    await user.click(within(row).getByRole('button', { name: 'Nudge' }));
    const gentle = within(row).getByText(/\$30\.00/, { selector: 'p.whitespace-pre-line' }).textContent;

    await user.click(within(row).getByRole('button', { name: 'playful' }));
    expect(within(row).getByText(/\$30\.00/, { selector: 'p.whitespace-pre-line' }).textContent).not.toBe(gentle);
  });
});

describe('the order of the list', () => {
  /*
   * Reading top-down should be a plan, not an arbitrary order. The biggest transfer is not always
   * the best first move, so the list defers to whichever payment clears the most people.
   */
  it('puts the best next move first and labels it', async () => {
    await open([CARA_PAYS, BOB_PAYS]);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Start here');
    expect(rows[0]).toHaveTextContent('Bob pays Alice');
    expect(rows[1]).not.toHaveTextContent('Start here');
  });

  /*
   * The label is the whole treatment. A "Best next move" card used to sit above the list naming the
   * same payment the top row names and flags, ten pixels apart, so the panel recommended once and
   * then recommended again.
   */
  it('names that move once, not twice', async () => {
    await open([CARA_PAYS, BOB_PAYS]);
    expect(screen.queryByText('Best next move')).not.toBeInTheDocument();
    // Counted on textContent: the row splits the sentence across three elements, so a text matcher
    // finds none of them and would pass no matter how many copies were on screen.
    const said = document.body.textContent?.match(/Bob pays Alice/g) ?? [];
    expect(said).toHaveLength(1);
  });

  it('does not say "start here" when there is only one thing to do', async () => {
    await open([BOB_PAYS]);
    expect(screen.queryByText('Start here')).not.toBeInTheDocument();
  });

  it('counts what is left to do', async () => {
    await open();
    expect(screen.getByText('2 transfers left')).toBeInTheDocument();
    expect(screen.getByText('$40.00 remaining')).toBeInTheDocument();
  });
});
