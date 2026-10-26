import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SharedGroupSummary } from '@owewell/core';
import { ApiError } from '../lib/api';

/**
 * The page a non-user lands on, driven. Its rules fail quietly and look like something else: a dead
 * link and a bad connection must get different screens, a seat claim must survive the round trip
 * through sign-in, and a member must not be able to claim a second seat.
 */

const NAMES = ['Alice', 'Bob', 'Cara'];

function summary(over: Partial<SharedGroupSummary> = {}): SharedGroupSummary {
  return {
    groupId: 'g1',
    groupName: 'Tahoe cabin',
    memberCount: 3,
    totalSpentCents: 9_000,
    perPersonCents: 3_000,
    totalSettledCents: 0,
    members: [
      { userId: 'u1', displayName: NAMES[0]!, netCents: 6_000, isPlaceholder: false },
      { userId: 'u2', displayName: NAMES[1]!, netCents: -3_000, isPlaceholder: true },
      { userId: 'u3', displayName: NAMES[2]!, netCents: -3_000, isPlaceholder: true },
    ],
    suggested: [{ fromName: NAMES[1]!, toName: NAMES[0]!, amountCents: 3_000 }],
    breakdown: [{ category: 'food', cents: 9_000 }],
    ...over,
  };
}

const sharedSummary = vi.fn<() => Promise<SharedGroupSummary>>();
const claimSeat = vi.fn<(token: string, personId: string) => Promise<{ groupId: string }>>();
vi.mock('../lib/groups', () => ({
  groupsApi: {
    sharedSummary: () => sharedSummary(),
    claimSeat: (token: string, personId: string) => claimSeat(token, personId),
  },
}));

// Created once, not per render: the page holds `claimSeat` in a useCallback keyed on these, and a
// fresh object each render would re-fire the effect that depends on it.
const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../components/Toast', () => ({ useToast: () => toastStub }));

const login = vi.fn();
let currentUser: { id: string; email: string; displayName: string } | null = null;
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: currentUser, login }) }));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

async function open(entry = '/s/tok') {
  const user = userEvent.setup();
  const { SharedGroupPage } = await import('./SharedGroupPage');
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/s/:token" element={<SharedGroupPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return user;
}

// Scoped to the roster: a name appears in the who-owes-who list too, and only the roster has seats.
const roster = () => within(screen.getByRole('heading', { name: 'Members' }).closest('section')!);
const rowFor = (name: string) => roster().getByText(name).closest('li')!;

beforeEach(() => {
  currentUser = null;
  for (const fn of [sharedSummary, claimSeat, login, navigate, toastStub.error]) fn.mockReset();
  sharedSummary.mockResolvedValue(summary());
  claimSeat.mockResolvedValue({ groupId: 'g1' });
});

describe('loading the tab', () => {
  it('ignores a late summary from the previous shared link', async () => {
    let finish!: (value: SharedGroupSummary) => void;
    sharedSummary.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    sharedSummary.mockResolvedValue(summary({ groupName: 'Second tab' }));
    const { SharedGroupPage } = await import('./SharedGroupPage');
    render(
      <MemoryRouter initialEntries={['/s/first']}>
        <Link to="/s/second">Second link</Link>
        <Routes>
          <Route path="/s/:token" element={<SharedGroupPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(sharedSummary).toHaveBeenCalledOnce());
    await userEvent.click(screen.getByRole('link', { name: 'Second link' }));
    await screen.findByRole('heading', { name: 'Second tab' });
    await act(async () => finish(summary({ groupName: 'Stale first tab' })));
    expect(screen.getByRole('heading', { name: 'Second tab' })).toBeVisible();
    expect(screen.queryByText('Stale first tab')).not.toBeInTheDocument();
  });

  it('does not open a previous group when its seat claim completes after navigation', async () => {
    currentUser = { id: 'u9', email: 'a@x.com', displayName: 'Aiden' };
    let finish!: (value: { groupId: string }) => void;
    claimSeat.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { SharedGroupPage } = await import('./SharedGroupPage');
    render(
      <MemoryRouter initialEntries={['/s/first']}>
        <Link to="/s/second">Second link</Link>
        <Routes>
          <Route path="/s/:token" element={<SharedGroupPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Tahoe cabin');
    await userEvent.click(within(rowFor('Bob')).getByRole('button', { name: 'This is me' }));
    sharedSummary.mockResolvedValue(summary({ groupName: 'Second tab' }));
    await userEvent.click(screen.getByRole('link', { name: 'Second link' }));
    await screen.findByRole('heading', { name: 'Second tab' });
    await act(async () => finish({ groupId: 'previous-group' }));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Second tab' })).toBeVisible();
  });

  it('shows a shape while it waits, then the group', async () => {
    await open();
    expect(screen.getByLabelText('Loading the tab')).toBeInTheDocument();
    expect(await screen.findByText('Tahoe cabin')).toBeInTheDocument();
    expect(screen.getByText('$90.00')).toBeInTheDocument();
  });

  /*
   * The distinction that matters. A 404 or 403 means the link really is dead; anything else means
   * the request did not arrive, and saying "this link isn't valid" to someone who was legitimately
   * invited sends them back to the person who invited them for no reason.
   */
  it.each([404, 403])('calls a %i a dead link', async (status) => {
    sharedSummary.mockRejectedValue(new ApiError(status, 'nope'));
    await open();
    expect(await screen.findByText(/This link isn.t valid/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();
  });

  it.each([[new ApiError(500, 'boom')], [new TypeError('Failed to fetch')]])(
    'treats %s as transient and offers a retry',
    async (err) => {
      sharedSummary.mockRejectedValue(err);
      await open();
      expect(await screen.findByText(/Couldn.t load this tab/)).toBeInTheDocument();
      expect(screen.queryByText(/isn.t valid/)).not.toBeInTheDocument();
    },
  );

  it('actually retries when asked', async () => {
    sharedSummary.mockRejectedValueOnce(new ApiError(500, 'boom'));
    const user = await open();
    await user.click(await screen.findByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('Tahoe cabin')).toBeInTheDocument();
  });
});

describe('claiming a seat', () => {
  it('offers a seat only where nobody has claimed one', async () => {
    await open();
    await screen.findByText('Tahoe cabin');
    expect(within(rowFor('Bob')).getByRole('button', { name: 'This is me' })).toBeInTheDocument();
    expect(within(rowFor('Alice')).queryByRole('button', { name: 'This is me' })).not.toBeInTheDocument();
  });

  /*
   * Signed out, the seat id has to survive a full-page redirect to the auth service and back, so it
   * goes in the return URL. Keeping it in memory would lose it the moment the browser navigates.
   */
  it('sends a signed-out visitor to sign in, carrying the seat with them', async () => {
    const user = await open();
    await screen.findByText('Tahoe cabin');
    await user.click(within(rowFor('Bob')).getByRole('button', { name: 'This is me' }));
    expect(login).toHaveBeenCalledWith(expect.stringContaining('/s/tok?claim=u2'));
    expect(claimSeat).not.toHaveBeenCalled();
  });

  it('claims it outright when already signed in, and opens the group', async () => {
    currentUser = { id: 'u9', email: 'a@x.com', displayName: 'Aiden' };
    const user = await open();
    await screen.findByText('Tahoe cabin');
    await user.click(within(rowFor('Bob')).getByRole('button', { name: 'This is me' }));
    await waitFor(() => expect(claimSeat).toHaveBeenCalledWith('tok', 'u2'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/groups/g1'));
  });

  it('refreshes the roster when a name was claimed by someone else', async () => {
    currentUser = { id: 'u9', email: 'a@x.com', displayName: 'Aiden' };
    claimSeat.mockRejectedValue(new ApiError(409, 'That seat already belongs to an account.'));
    const user = await open();
    await screen.findByText('Tahoe cabin');
    sharedSummary.mockResolvedValue(
      summary({ members: summary().members.map((member) => ({ ...member, isPlaceholder: false })) }),
    );
    await user.click(within(rowFor('Bob')).getByRole('button', { name: 'This is me' }));
    await waitFor(() => expect(sharedSummary).toHaveBeenCalledTimes(2));
    await screen.findByText('Viewing only. Ask a member to add you to edit this group.');
    expect(screen.queryByRole('button', { name: 'This is me' })).not.toBeInTheDocument();
  });

  it('says why it failed and leaves the seat claimable', async () => {
    currentUser = { id: 'u9', email: 'a@x.com', displayName: 'Aiden' };
    claimSeat.mockRejectedValue(new Error('That spot is taken.'));
    const user = await open();
    await screen.findByText('Tahoe cabin');
    await user.click(within(rowFor('Bob')).getByRole('button', { name: 'This is me' }));
    await waitFor(() => expect(toastStub.error).toHaveBeenCalledWith('That spot is taken.'));
    expect(navigate).not.toHaveBeenCalled();
    expect(within(rowFor('Bob')).getByRole('button', { name: 'This is me' })).toBeEnabled();
  });

  // Somebody already in the group has nothing to claim; they get a way in instead.
  it('offers a member the group rather than a seat', async () => {
    currentUser = { id: 'u1', email: 'a@x.com', displayName: 'Alice' };
    await open();
    await screen.findByText('Tahoe cabin');
    expect(screen.queryByRole('button', { name: 'This is me' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open in owewell/ })).toBeInTheDocument();
  });
});

describe('coming back from sign-in with ?claim=', () => {
  it('finishes the claim without being asked twice', async () => {
    currentUser = { id: 'u9', email: 'a@x.com', displayName: 'Aiden' };
    await open('/s/tok?claim=u2');
    await waitFor(() => expect(claimSeat).toHaveBeenCalledWith('tok', 'u2'));
    expect(claimSeat).toHaveBeenCalledTimes(1);
  });

  /*
   * The one that would corrupt data rather than merely annoy. A member returning with a stale
   * ?claim= must not merge a second seat into the group they are already in.
   */
  it('takes an existing member straight in instead of claiming again', async () => {
    currentUser = { id: 'u1', email: 'a@x.com', displayName: 'Alice' };
    await open('/s/tok?claim=u2');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/groups/g1'));
    expect(claimSeat).not.toHaveBeenCalled();
  });
});
