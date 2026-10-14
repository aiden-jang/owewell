import type { ErrorHandler } from 'hono';
import type { Env } from './env.js';
import type { Person } from './people.js';
import { GroupError } from './groups.js';
import { ExpenseError } from './expenses.js';
import { SettlementError } from './settlements.js';
import { QuickSplitError } from './quicksplit.js';
import { SettleError } from '@owewell/shared';

export const handleApiError: ErrorHandler<{ Bindings: Env; Variables: { person: Person } }> = (err, c) => {
  if (err instanceof GroupError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'NOT_OWNER' || err.code === 'CANNOT_REMOVE_OWNER'
          ? 403
          : 409;
    return c.json({ error: err.code, message: err.message }, status);
  }
  if (err instanceof ExpenseError) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'CONFLICT' ? 409 : 422;
    return c.json({ error: err.code, message: err.message }, status);
  }
  if (err instanceof SettlementError) {
    return c.json({ error: err.code, message: err.message }, err.code === 'NOT_FOUND' ? 404 : 422);
  }
  if (err instanceof QuickSplitError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  // A broken ledger invariant. Still a 500 (the data is wrong, not the request), but it carries the
  // message: reporting this as a bare INTERNAL is what turned a one-line diagnosis into an afternoon.
  if (err instanceof SettleError) {
    console.error('owewell ledger invariant broken', err);
    return c.json({ error: 'LEDGER_INVARIANT', message: err.message }, 500);
  }
  console.error('owewell api error', err);
  return c.json({ error: 'INTERNAL' }, 500);
};
