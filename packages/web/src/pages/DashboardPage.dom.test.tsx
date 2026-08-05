import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { GroupSummary } from '../lib/groups';

/**
 * The dashboard, driven rather than eyeballed.
 *
 * All three things tested here were reported by hand, and none of them are visible to a typecheck:
 *   1. "New" and "Select" were independent booleans, so both could be open at once — the name field
 *      sat under the selection UI while select mode's bottom bar pushed the page around.
 *   2. Pressing Create with an empty name returned silently, which looks like a frozen app.
 *   3. Each row needed a date, and it should say when something last HAPPENED, not when the group
 *      was created.
 *
 * The dashboard needs a signed-in session in the real app, so verifying it used to mean a human
 * logging in. That is the gap these close.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function group(over: Partial<GroupSummary> = {}): GroupSummary {
  return {
    id: 'g1',
    name: 'Tahoe trip',
    createdAt: new Date(Date.now() - 30 * DAY).toISOString(),
    archived: false,
    memberCount: 4,
    netCents: 0,
    totalUnsettledCents: 0,
    totalSpentCents: 5000,
    lastActivityAt: new Date(Date.now() - 2 * DAY).toISOString(),
    isOwner: true,
    ...over,
  };
}

const list = vi.fn<() => Promise<GroupSummary[]>>();
const create = vi.fn();

vi.mock('../lib/groups', () => ({
  groupsApi: {
    list: () => list(),
    create: (name: string) => create(name),
    // The page calls these per id, not in bulk. Named wrongly, they are undefined at the call site and
    // the failure surfaces as "cannot read properties of undefined (reading 'then')".
    setArchived: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../lib/quicksplit', () => ({
  loadPendingSplit: () => null,
  clearPendingSplit: vi.fn(),
  quickSplitApi: { save: vi.fn() },
}));

vi.mock('../components/AppHeader', () => ({ AppHeader: () => null }));

// Context providers the page consumes but this file is not testing. Mocked rather than wired up: the
// point is to drive the dashboard's own behaviour, not to assemble the whole app shell.
//
// These objects are created ONCE, not per render. The page has `useCallback(..., [toast])`, so a hook
// mock that returns a fresh object every render changes the callback's identity every render, which
// refires the effect that calls it, forever. My first attempt did exactly that and the file took ten
// seconds to fail in a way that looked like the page's fault.
const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
const confirmStub = vi.fn().mockResolvedValue(true);

vi.mock('../components/Confirm', () => ({ useConfirm: () => confirmStub }));
vi.mock('../components/Toast', () => ({ useToast: () => toastStub }));

async function open(groups: GroupSummary[] = [group()]) {
  list.mockResolvedValue(groups);
  const { DashboardPage } = await import('./DashboardPage');
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
  // Wait for the first load, so tests never race the skeleton.
  await waitFor(() => expect(screen.getByRole('button', { name: /new/i })).toBeInTheDocument());
  return userEvent.setup();
}

beforeEach(() => {
  list.mockReset();
  create.mockReset();
  toastStub.success.mockClear();
  toastStub.error.mockClear();
  create.mockResolvedValue({ id: 'new1', name: 'Whatever', createdAt: new Date().toISOString(), members: [{}] });
});

describe('creating a group', () => {
  test('Create is disabled until the name has something in it', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /new/i }));

    const submit = screen.getByRole('button', { name: /^create$/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'Ski trip');
    expect(submit).toBeEnabled();
  });

  test('says a name is required instead of doing nothing', async () => {
    // The reported symptom: pressing Create with an empty field looked like the app had frozen.
    const user = await open();
    await user.click(screen.getByRole('button', { name: /new/i }));

    const input = screen.getByRole('textbox');
    expect(input).not.toHaveAttribute('aria-invalid', 'true');

    await user.click(input);
    await user.tab(); // leave it empty

    expect(await screen.findByText(/give the group a name/i)).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(create).not.toHaveBeenCalled();
  });

  test('closes and clears after a successful create', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /new/i }));
    await user.type(screen.getByRole('textbox'), 'Ski trip');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(create).toHaveBeenCalledWith('Ski trip'));
    // Re-opening must not show the previous name still sitting there.
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new/i }));
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  test('Escape closes the form', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /new/i }));
    await user.type(screen.getByRole('textbox'), 'Half typed{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('New and Select are one at a time', () => {
  test('entering select mode closes the name field', async () => {
    // The exact report: click New, then Select, and the input stayed open while the footer moved.
    const user = await open();
    await user.click(screen.getByRole('button', { name: /new/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /select/i }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('opening the name field leaves select mode', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /select/i }));
    // Select mode swaps the buttons for Cancel, so getting back to New means leaving it first.
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    await user.click(screen.getByRole('button', { name: /new/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  test('New toggles itself shut on a second click', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /new/i }));
    await user.click(screen.getByRole('button', { name: /new/i }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('the date on each row', () => {
  test('shows when something last happened, not when the group was made', async () => {
    await open([
      group({
        createdAt: new Date(Date.now() - 300 * DAY).toISOString(),
        lastActivityAt: new Date(Date.now() - 2 * DAY).toISOString(),
        totalSpentCents: 5000,
      }),
    ]);
    const row = screen.getByText('Tahoe trip').closest('li')!;
    expect(within(row).getByText(/2 days ago/)).toBeInTheDocument();
    // 300 days ago would render as a month name; it must not appear.
    expect(within(row).queryByText(/^in /)).not.toBeInTheDocument();
  });

  test('says "started" for a group with nothing spent yet', async () => {
    // Calling an empty group's creation date "activity" would be a lie.
    await open([group({ totalSpentCents: 0, createdAt: new Date(Date.now() - 3 * DAY).toISOString() })]);
    const row = screen.getByText('Tahoe trip').closest('li')!;
    expect(within(row).getByText(/started 3 days ago/)).toBeInTheDocument();
  });

  test('keeps the member count alongside it', async () => {
    await open([group({ memberCount: 1 })]);
    const row = screen.getByText('Tahoe trip').closest('li')!;
    expect(within(row).getByText(/1 person/)).toBeInTheDocument();
  });
});
