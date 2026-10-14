import type { PendingSplit } from '../lib/quicksplit';
import { Icon } from './Icon';

type Props = { pending: PendingSplit; busy: boolean; onSave: () => void; onDismiss: () => void };

export function PendingSplitCard({ pending, busy, onSave, onDismiss }: Props) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3">
      <span className="flex items-center gap-2 text-sm">
        <Icon name="sparkles" size={16} className="text-accent" />
        Your split is ready to save:{' '}
        <span className="font-medium">
          {pending.items[0]?.description || 'Quick split'}
          {pending.items.length > 1 ? ` +${pending.items.length - 1} more` : ''}
        </span>
        .
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSave()}
          disabled={busy}
          className="btn-gradient rounded-full px-3.5 py-1.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save split'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full border border-line px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
