import { dollarsToCents, Money } from '@owewell/shared';
import { draftId, type QuickSplitDraft } from '../lib/quickSplitDraft';
import { inputClass } from './FormFields';
import { SelectField } from './SelectField';

const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' });

function labelFor(draft: QuickSplitDraft): string {
  const firstItem = draft.items.find((item) => item.description.trim() || item.amount.trim());
  const name = firstItem?.description.trim() || 'Untitled bill';
  let amount = '';
  try {
    if (firstItem?.amount.trim()) amount = ` · ${Money.fromCents(dollarsToCents(firstItem.amount)).format()}`;
  } catch {
    // An unfinished amount is still recoverable.
  }
  return `${name}${amount} · ${time.format(draft.savedAt)}`;
}

export function QuickSplitDraftNotice({
  restored,
  otherDrafts,
  saving,
  onStartFresh,
  onRestore,
}: {
  restored: boolean;
  otherDrafts: QuickSplitDraft[];
  saving: boolean;
  onStartFresh: () => Promise<void>;
  onRestore: (draft: QuickSplitDraft) => void;
}) {
  if (!restored && !otherDrafts.length) return null;
  return (
    <div className="split-draft flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface2/60 px-4 py-3 text-sm">
      <span>
        <span className="font-semibold text-ink">
          {restored ? 'Your split is back.' : 'You have a saved split.'}
        </span>{' '}
        <span className="text-muted">
          {otherDrafts.length
            ? 'Other drafts are saved on this device.'
            : 'We kept this draft on this device.'}
        </span>
      </span>
      {restored && (
        <button
          type="button"
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            void onStartFresh();
          }}
          disabled={saving}
          className="shrink-0 font-medium text-muted transition hover:text-ink hover:underline"
        >
          Start fresh
        </button>
      )}
      {otherDrafts.length > 0 && (
        <SelectField
          wrapperClassName="w-full min-w-0"
          className={`${inputClass} min-w-0 truncate`}
          aria-label="Open another saved draft"
          value=""
          disabled={saving}
          onChange={(event) => {
            const draft = otherDrafts.find((candidate) => draftId(candidate) === event.target.value);
            if (draft) onRestore(draft);
          }}
        >
          <option value="" disabled>
            Open another saved draft…
          </option>
          {otherDrafts.map((draft) => (
            <option key={draftId(draft)} value={draftId(draft)}>
              {labelFor(draft)}
            </option>
          ))}
        </SelectField>
      )}
    </div>
  );
}
