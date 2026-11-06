import type { PendingSplit } from '../lib/quicksplit';
import { Icon } from './Icon';
import { formatMoney } from '@owewell/shared';
import { useId } from 'react';

type Props = {
  pending: PendingSplit;
  busy: boolean;
  saving: boolean;
  onSave: () => void;
  onDismiss: () => void;
};

export function PendingSplitCard({ pending, busy, saving, onSave, onDismiss }: Props) {
  const summaryId = useId();
  const total = formatMoney(pending.items.reduce((sum, item) => sum + item.amountCents, 0));
  return (
    <section
      aria-labelledby={summaryId}
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3"
    >
      <div className="flex min-w-0 flex-[1_1_16rem] items-start gap-2 text-sm">
        <Icon name="sparkles" size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <p className="text-muted">Your split is ready to save</p>
          <p id={summaryId} className="font-medium [overflow-wrap:anywhere]">
            {pending.items[0]?.description || 'Quick split'}
            {pending.items.length > 1 ? ` +${pending.items.length - 1} more` : ''}
            {' · '}
            <span className="tnum whitespace-nowrap">{total}</span>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSave()}
          disabled={busy}
          aria-describedby={summaryId}
          className="btn-gradient min-h-11 rounded-full px-3.5 py-1.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save split'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="min-h-11 rounded-full border border-line px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink disabled:opacity-60"
        >
          Not now
        </button>
      </div>
    </section>
  );
}
