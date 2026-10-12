import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

/**
 * Splitting a bill without an account, which is the page that does arithmetic in public.
 *
 * Everything under test here is money. The shared libraries are covered on their own, but this page
 * has its own layer on top of them — how a tip is derived from each item, which payer covers which
 * line, and how the odd cent is seeded — and none of that had a test. A mistake in any of it is a
 * number somebody sends to a friend.
 */

vi.mock('../components/AppHeader', () => ({ AppHeader: () => null }));

const authStub = {
  user: null,
  loading: false,
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  accountUrl: 'https://accounts.example/account',
};
vi.mock('../auth/AuthContext', () => ({ useAuth: () => authStub }));
vi.mock('../lib/quicksplit', () => ({
  clearPendingSplit: vi.fn(),
  stashPendingSplit: vi.fn(),
  quickSplitApi: { save: vi.fn() },
}));

async function open() {
  const { QuickSplitPage } = await import('./QuickSplitPage');
  render(
    <MemoryRouter>
      <QuickSplitPage />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

type U = ReturnType<typeof userEvent.setup>;

/** Name the two people the page starts with. */
async function namePeople(user: U, ...names: string[]): Promise<void> {
  for (const [i, name] of names.entries()) {
    if (i > 1) await user.click(screen.getByRole('button', { name: /Add person/i }));
    const field = screen.getByLabelText(`Person ${i + 1} name`);
    await user.clear(field);
    await user.type(field, name);
  }
}

async function fillItem(user: U, index: number, description: string, amount: string): Promise<void> {
  const field = screen.getByLabelText(`Item ${index} description`);
  const details = field.closest('details');
  if (details && !details.open) await user.click(details.querySelector('summary')!);
  await user.type(field, description);
  await user.type(screen.getByLabelText(`Item ${index} amount`), amount);
}

/** Every "A owes B $x" line currently on screen. */
const owedLines = () =>
  screen
    .queryAllByRole('listitem')
    .map((li) => li.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter((t) => t.includes('owes'));

beforeEach(() => {
  window.localStorage.clear();
  authStub.signup.mockReset();
});

describe('the split itself', () => {
  it('starts with a bill amount and keeps optional controls behind a disclosure', async () => {
    const user = await open();
    expect(screen.getByLabelText('Item 1 amount')).toBeVisible();
    expect(screen.getByLabelText('Item 1 description')).not.toBeVisible();
    await user.click(screen.getByText('Details & split options'));
    expect(screen.getByLabelText('Item 1 description')).toBeVisible();
    await user.type(screen.getByLabelText('Item 1 description'), 'Dinner');
    await user.clear(screen.getByLabelText('Item 1 description'));
    expect(screen.getByLabelText('Item 1 description')).toBeVisible();
  });
  it('lets a fresh visitor explore an explicitly labeled example', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Try a \$48 example/ }));
    expect(screen.getByLabelText('Item 1 description')).toHaveValue('Dinner (example)');
    expect(owedLines()).toEqual(['Sam owes You$16.00', 'Jo owes You$16.00']);
  });

  it('hides the example action as soon as a visitor starts their own bill', async () => {
    const user = await open();
    await user.click(screen.getByText('Details & split options'));
    await user.type(screen.getByLabelText('Item 1 description'), 'My dinner');
    expect(screen.queryByRole('button', { name: /Try a \$48 example/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Item 1 description')).toHaveValue('My dinner');
  });

  it('divides a bill evenly and names who owes whom', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '40.00');

    expect(owedLines().join(' ')).toContain('Bob');
    expect(owedLines().join(' ')).toContain('$20.00');
  });

  /*
   * The number the transfer list structurally cannot show you: it only names people who owe
   * somebody, so whoever paid never appears in it and "what did this cost me" is left to arithmetic.
   */
  it('tells the payer their own share, which the transfer list never can', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '40.00');

    // Alice paid and is owed, so she is absent from the transfers above.
    expect(owedLines().join(' ')).not.toContain('Alice owes');
    const share = screen.getByText('Your share').closest('p')!;
    expect(share).toHaveTextContent('$20.00');
  });

  it('says so when the split comes out level', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '40.00');
    // Bob covers his own line, so nobody owes anybody.
    await user.click(screen.getByLabelText('different people paid'));
    await user.click(screen.getByRole('button', { name: /Add item/i }));
    await fillItem(user, 2, 'Drinks', '40.00');
    await user.selectOptions(
      screen.getByLabelText('Item 2 paid by'),
      screen.getByLabelText('Item 2 paid by').querySelectorAll('option')[1]!,
    );

    expect(screen.getByText('All settled up. Nobody owes anybody.')).toBeInTheDocument();
  });
});

describe('adding a tip', () => {
  it('adds one line per item, at the percentage asked for', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '100.00');
    await user.click(screen.getByRole('button', { name: '20%' }));

    expect(screen.getByLabelText('Item 2 description')).toHaveValue('Dinner tip (20%)');
    expect(screen.getByLabelText('Item 2 amount')).toHaveValue('20.00');
  });

  /*
   * A preset is a choice, not an additive action. Tapping 18 then 20 has to mean "make it 20", or a
   * change of mind quietly charges the table 38%.
   */
  it('replaces the tip when you change your mind, rather than charging both', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '100.00');

    await user.click(screen.getByRole('button', { name: '18%' }));
    await user.click(screen.getByRole('button', { name: '20%' }));

    expect(screen.queryByDisplayValue('Dinner tip (18%)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Item 2 description')).toHaveValue('Dinner tip (20%)');
    expect(screen.queryByLabelText('Item 3 description')).not.toBeInTheDocument();
  });

  // Otherwise a second tap compounds: a tip on the tip.
  it('never tips a tip', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '100.00');
    await user.click(screen.getByRole('button', { name: '20%' }));
    await user.click(screen.getByRole('button', { name: '25%' }));

    expect(screen.getByLabelText('Item 2 amount')).toHaveValue('25.00');
    expect(screen.queryByLabelText('Item 3 amount')).not.toBeInTheDocument();
  });

  // Somebody who typed their own tip line does not want a second one derived from it.
  it('leaves a hand-written tip line alone', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Service tip', '15.00');
    await user.click(screen.getByRole('button', { name: '20%' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Add an item amount before calculating a tip.');
    expect(screen.queryByLabelText('Item 2 description')).not.toBeInTheDocument();
  });

  /*
   * Exact dollar amounts cannot be scaled: the per-person values were typed to sum to the item, and
   * a percentage of each is not what anyone agreed. Refusing is better than guessing.
   */
  it('refuses rather than guessing when an item is split by exact amounts', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '100.00');
    await user.selectOptions(screen.getByLabelText('Item 1 split method'), 'EXACT');
    await user.click(screen.getByRole('button', { name: '20%' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Add the tip manually');
    expect(screen.queryByLabelText('Item 2 description')).not.toBeInTheDocument();
  });

  it('says there is nothing to tip rather than doing nothing', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await user.click(screen.getByRole('button', { name: '20%' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Add an item amount before calculating a tip.');
  });

  it('refuses a percentage outside 1 to 100', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '100.00');
    await user.type(screen.getByPlaceholderText('other'), '150');
    await user.click(screen.getByRole('button', { name: 'Apply custom tip' }));

    expect(screen.getByRole('alert')).toHaveTextContent('from 1 to 100');
  });

  it('takes it back off again', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '100.00');
    await user.click(screen.getByRole('button', { name: '20%' }));
    await user.click(screen.getByRole('button', { name: 'remove' }));

    expect(screen.queryByLabelText('Item 2 description')).not.toBeInTheDocument();
  });
});

describe('the running total for a non-equal split', () => {
  // Visible before saving, so values that do not add up are caught while they can still be fixed.
  it('counts exact amounts against the item total', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '40.00');
    await user.selectOptions(screen.getByLabelText('Item 1 split method'), 'EXACT');
    await user.type(screen.getByLabelText('Alice $ for item 1'), '30');

    expect(screen.getByText('$30.00 of $40.00')).toBeInTheDocument();
  });

  it('counts percentages against 100', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '40.00');
    await user.selectOptions(screen.getByLabelText('Item 1 split method'), 'PERCENT');
    await user.type(screen.getByLabelText('Alice % for item 1'), '60');

    expect(screen.getByText('60% of 100%')).toBeInTheDocument();
  });
});

describe('who paid for which line', () => {
  it('uses the default payer for a line with none chosen', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '40.00');
    const beforeToggle = owedLines();

    await user.click(screen.getByLabelText('different people paid'));
    expect(owedLines()).toEqual(beforeToggle);
  });

  it('clears a per-item payer when that person is removed', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob', 'Cara');
    await fillItem(user, 1, 'Dinner', '60.00');
    await user.click(screen.getByLabelText('different people paid'));

    const paidBy = screen.getByLabelText('Item 1 paid by');
    await user.selectOptions(paidBy, paidBy.querySelectorAll('option')[2]!); // Cara
    await user.click(screen.getByRole('button', { name: 'Remove person 3' }));

    // Back to Alice, and the $60 is still accounted for rather than credited to nobody.
    expect(owedLines()).toEqual(['Bob owes Alice$30.00']);
  });

  /*
   * A restored draft is the one way an item can name a payer who does not exist: the reader checks
   * that payerId is a string but never that it belongs to anybody, and it filters the people list
   * while items keep their references. Without the guard that item's payment is credited to an id
   * nobody is netting, so the money vanishes and everyone owes for a bill already covered.
   */
  it('survives a draft whose payer does not exist', async () => {
    window.localStorage.setItem(
      'owewell:quick-split-draft',
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        people: [
          { id: 'alice', name: 'Alice' },
          { id: 'bob', name: 'Bob' },
        ],
        items: [
          { id: 'i1', description: 'Dinner', amount: '60.00', method: 'EQUAL', values: {}, payerId: 'ghost' },
        ],
        payerId: 'alice',
        splitPayers: true,
        youId: 'alice',
      }),
    );
    await open();

    expect(owedLines()).toEqual(['Bob owes Alice$30.00']);
  });

  it('moves the debt when a different person covers a line', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '40.00');
    await user.click(screen.getByLabelText('different people paid'));

    const paidBy = screen.getByLabelText('Item 1 paid by');
    await user.selectOptions(paidBy, paidBy.querySelectorAll('option')[1]!);
    // Bob covered it, so the debt runs the other way.
    expect(owedLines().join(' ')).toContain('Alice');
  });
});

describe('the odd cent', () => {
  /*
   * Each item is seeded by its position among the items that will actually be SENT, not its index in
   * the array — the save path drops blank rows, so a raw index would put the leftover cent on a
   * different person the moment somebody left a gap above. The rule is invisible until it is wrong.
   */
  it('lands in the same place whether or not there is a blank line above', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob', 'Cara');
    // $10 across three people is 334/333/333: exactly the case with a cent to place.
    await fillItem(user, 1, 'Dinner', '10.00');
    const withoutGap = owedLines();

    await user.clear(screen.getByLabelText('Item 1 description'));
    await user.clear(screen.getByLabelText('Item 1 amount'));
    await user.click(screen.getByRole('button', { name: /Add item/i }));
    await fillItem(user, 2, 'Dinner', '10.00');

    expect(owedLines()).toEqual(withoutGap);
  });
});

describe('the verdict', () => {
  /*
   * Generated from the numbers, so it is only ever true, and ordered rarest first: an earlier
   * version led with "one person paid for everything", which is the default arrangement and fired on
   * nearly every bill until it stopped reading as a remark.
   */
  it('notices when somebody owes nothing at all', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob', 'Cara');
    await fillItem(user, 1, 'Dinner', '40.00');
    await user.selectOptions(screen.getByLabelText('Item 1 split method'), 'EXACT');
    await user.type(screen.getByLabelText('Alice $ for item 1'), '20');
    await user.type(screen.getByLabelText('Bob $ for item 1'), '20');
    await user.type(screen.getByLabelText('Cara $ for item 1'), '0');

    expect(screen.getByText('Cara owes nothing. Must be nice.')).toBeInTheDocument();
  });

  it('notices a share that is lopsided on purpose rather than by a rounding cent', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '100.00');
    await user.selectOptions(screen.getByLabelText('Item 1 split method'), 'EXACT');
    await user.type(screen.getByLabelText('Alice $ for item 1'), '10');
    await user.type(screen.getByLabelText('Bob $ for item 1'), '90');

    expect(screen.getByText('Bob got the steak.')).toBeInTheDocument();
  });

  // An even split is the ordinary case, and a remark on every ordinary bill is furniture.
  it('stays quiet on a plain even split', async () => {
    const user = await open();
    await namePeople(user, 'Alice', 'Bob');
    await fillItem(user, 1, 'Dinner', '40.00');

    expect(screen.queryByText(/Must be nice|got the steak|allegedly/)).not.toBeInTheDocument();
  });
});
