import { Icon } from './Icon';

export function BulkGroupBar({
  count,
  busy,
  canDelete,
  onArchive,
  onDelete,
}: {
  count: number;
  busy: boolean;
  canDelete: boolean;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <span role="status" className="text-sm font-medium">
          {busy ? 'Updating groups…' : `${count} selected`}
        </span>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onArchive()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-4 py-2 text-sm font-medium transition hover:border-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="archive" size={15} /> Archive
          </button>
          <button
            type="button"
            onClick={() => void onDelete()}
            disabled={!canDelete || busy}
            title={canDelete ? undefined : 'You can only delete groups you own'}
            className="inline-flex items-center gap-1.5 rounded-full bg-neg-solid px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="trash" size={15} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
