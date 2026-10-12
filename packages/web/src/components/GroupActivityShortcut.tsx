import type { Expense } from '../lib/expenses';
import { Icon } from './Icon';
import { useMoney } from '../lib/currency';

/** The latest real entry and the everyday action sit together before settlement detail. */
export function GroupActivityShortcut({
  expenses,
  onAdd,
  onOpen,
}: {
  expenses: Expense[];
  onAdd: () => void;
  onOpen: (id: string) => void;
}) {
  const fmt = useMoney();
  const latest = expenses.reduce<Expense | null>(
    (last, expense) => (!last || expense.createdAt > last.createdAt ? expense : last),
    null,
  );
  return (
    <div className="group-activity-shortcut">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted">Latest expense</p>
        {latest ? (
          <button type="button" onClick={() => onOpen(latest.id)} className="latest-expense">
            <span className="truncate">{latest.description}</span>
            <span className="shrink-0 tabular-nums">{fmt(latest.amountCents)}</span>
          </button>
        ) : (
          <p className="text-sm text-muted">No expenses yet</p>
        )}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="btn-gradient inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold"
      >
        <Icon name="plus" size={18} /> Add expense
      </button>
    </div>
  );
}
