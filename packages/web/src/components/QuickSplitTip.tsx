import { Money } from '@owewell/shared';

interface Props {
  generatedTipTotal: number;
  activeTip: number | null;
  customTip: string;
  setCustomTip: (value: string) => void;
  addTip: (percent: number) => void;
  clearGeneratedTip: () => void;
}

/** Tips are optional for shared bills; an applied tip stays visible. */
export function QuickSplitTip({
  generatedTipTotal,
  activeTip,
  customTip,
  setCustomTip,
  addTip,
  clearGeneratedTip,
}: Props) {
  return (
    <details className="split-tip" open={activeTip !== null}>
      <summary>
        Add a tip{generatedTipTotal > 0 ? ` · ${Money.fromCents(generatedTipTotal).format()}` : ''}
      </summary>
      <div className="flex flex-wrap items-center gap-2 pt-3" aria-label="Add tip">
        <span className="text-xs text-muted">
          {generatedTipTotal > 0 ? `tip ${Money.fromCents(generatedTipTotal).format()}` : 'add tip'}
        </span>
        {[18, 20, 25].map((percent) => (
          <button
            key={percent}
            type="button"
            onClick={() => addTip(percent)}
            aria-pressed={activeTip === percent}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition active:scale-[0.96] ${
              activeTip === percent
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line bg-field text-muted hover:border-accent hover:text-accent'
            }`}
          >
            {percent}%
          </button>
        ))}
        <label className="flex items-center rounded-full border border-line bg-field pl-2.5 text-xs text-muted focus-within:border-accent">
          <span className="sr-only">Custom tip percentage</span>
          <input
            value={customTip}
            onChange={(event) => setCustomTip(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTip(Number(customTip));
              }
            }}
            placeholder="other"
            inputMode="decimal"
            className="w-12 bg-transparent py-1 outline-none placeholder:text-muted/70"
          />
          <button
            type="button"
            onClick={() => addTip(Number(customTip))}
            className="px-2 py-1 font-semibold text-muted transition hover:text-ink"
            aria-label="Apply custom tip"
          >
            %
          </button>
        </label>
        {activeTip !== null && (
          <button
            type="button"
            onClick={clearGeneratedTip}
            className="text-xs text-muted transition hover:text-ink hover:underline"
          >
            remove
          </button>
        )}
      </div>
    </details>
  );
}
