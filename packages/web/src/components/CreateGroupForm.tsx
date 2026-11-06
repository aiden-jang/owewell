import { useRef, type FormEvent } from 'react';
import { GroupArtwork } from './GroupArtwork';

type Props = {
  name: string;
  nameTouched: boolean;
  busy: boolean;
  error: string | null;
  onNameChange: (name: string) => void;
  onTouch: () => void;
  onSubmit: (event: FormEvent) => void;
};

export function CreateGroupForm({ name, nameTouched, busy, error, onNameChange, onTouch, onSubmit }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const ideas = useRef<HTMLDetailsElement>(null);
  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="new-group-name" className="field-label">
        Group name
      </label>
      <div className="flex gap-2">
        <input
          ref={input}
          id="new-group-name"
          required
          readOnly={busy}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={(event) => {
            if (
              event.relatedTarget instanceof Element &&
              event.relatedTarget.closest('.group-ideas, .sheet-header')
            )
              return;
            onTouch();
          }}
          aria-invalid={nameTouched && !name.trim()}
          aria-describedby="group-name-hint"
          placeholder="Weekend trip…"
          className={`min-w-0 flex-1 rounded-xl border bg-field px-3.5 py-2.5 outline-none transition focus:ring-2 focus:ring-accent/20 ${
            nameTouched && !name.trim() ? 'border-neg' : 'border-line focus:border-accent'
          }`}
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          aria-busy={busy}
          className="btn-gradient shrink-0 rounded-full px-5 py-2.5 font-semibold transition active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? 'Adding…' : 'Create'}
        </button>
      </div>
      <p
        id="group-name-hint"
        className={`mt-1.5 text-sm ${nameTouched && !name.trim() ? 'font-medium text-neg' : 'text-faint'}`}
      >
        {nameTouched && !name.trim()
          ? 'Give the group a name to create it.'
          : 'Name it after the trip, the flat, or the people.'}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-neg">
          {error}
        </p>
      )}
      <details ref={ideas} className="group-ideas">
        <summary>
          Group ideas <span className="text-faint">optional</span>
        </summary>
        <div className="group-ideas-grid" role="group" aria-label="Group name ideas">
          {['Dinner', 'Trip', 'Home'].map((idea) => (
            <button
              type="button"
              key={idea}
              disabled={busy}
              onClick={() => {
                onNameChange(idea);
                if (ideas.current) ideas.current.open = false;
                input.current?.focus();
              }}
            >
              <GroupArtwork name={idea} />
              <span>{idea}</span>
            </button>
          ))}
        </div>
      </details>
    </form>
  );
}
