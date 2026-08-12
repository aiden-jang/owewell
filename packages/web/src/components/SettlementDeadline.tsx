import { useState } from 'react';
import type { SuggestedPayment } from '../lib/settlements';
import { deadlinePresets, deadlineState, settlementDeadlineCalendar } from '../lib/settleDeadline';

function localInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function SettlementDeadline({
  groupName,
  settleBy,
  suggestions,
  isOwner,
  onSave,
}: {
  groupName: string;
  settleBy: string | null;
  suggestions: SuggestedPayment[];
  isOwner: boolean;
  onSave: (settleBy: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => localInput(deadlinePresets()[1]!.value));
  const [saving, setSaving] = useState(false);
  const [savedCalendar, setSavedCalendar] = useState(false);
  // Reads the outstanding transfers, not just the clock: a settled group has no deadline to be late for.
  const status = settleBy ? deadlineState(settleBy, suggestions.length) : null;

  async function save(value: string | null): Promise<void> {
    setSaving(true);
    try {
      await onSave(value);
      setEditing(false);
    } catch {
      // The page owns the toast. Keep the editor open so the chosen time is not lost.
    } finally {
      setSaving(false);
    }
  }

  function downloadCalendar(): void {
    if (!settleBy) return;
    const href = URL.createObjectURL(new Blob([settlementDeadlineCalendar(groupName, settleBy, suggestions)], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = `${groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'owewell'}-settle-by.ics`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
    setSavedCalendar(true);
    window.setTimeout(() => setSavedCalendar(false), 2200);
  }

  if (!settleBy && !isOwner) return null;

  return (
    <section className={`mt-3 rounded-xl border p-3 ${status?.tone === 'late' ? 'border-neg/25 bg-neg/5' : 'border-accent/20 bg-surface/75'}`} aria-label="Settle-by deadline">
      {editing ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">Set a finish line</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {deadlinePresets().map(preset => (
              <button key={preset.label} type="button" onClick={() => setDraft(localInput(preset.value))} className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted hover:border-accent hover:text-ink">
                {preset.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input type="datetime-local" value={draft} min={localInput(new Date())} onChange={event => setDraft(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-field px-3 py-2 text-xs text-ink outline-none focus:border-accent" />
            <button type="button" disabled={saving || !draft} onClick={() => void save(new Date(draft).toISOString())} className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Set deadline'}
            </button>
          </div>
          <button type="button" onClick={() => setEditing(false)} className="mt-2 text-[11px] font-medium text-muted hover:text-ink">Cancel</button>
        </div>
      ) : settleBy ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">Settle by</span>
            <strong className="mt-0.5 block text-sm text-ink">{new Date(settleBy).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</strong>
            <small className={`block text-[11px] font-medium ${status?.tone === 'late' ? 'text-neg' : status?.tone === 'soon' ? 'text-accent' : 'text-muted'}`}>{status?.label}</small>
          </span>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={downloadCalendar} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent hover:text-accent">{savedCalendar ? 'Added ✓' : 'Add reminder'}</button>
            {isOwner && <button type="button" onClick={() => { setDraft(localInput(new Date(settleBy))); setEditing(true); }} className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-ink">Change</button>}
            {isOwner && <button type="button" disabled={saving} onClick={() => void save(null)} className="rounded-full px-2 py-1.5 text-xs font-medium text-muted hover:text-neg">Clear</button>}
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="flex w-full items-center justify-between gap-3 text-left">
          <span><strong className="block text-xs text-ink">Give the tab a finish line</strong><small className="mt-0.5 block text-[11px] text-muted">Pick a settle-by time and everyone can add a reminder.</small></span>
          <span className="text-accent" aria-hidden>＋</span>
        </button>
      )}
    </section>
  );
}
