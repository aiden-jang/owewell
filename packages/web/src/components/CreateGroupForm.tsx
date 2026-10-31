import { useRef, type FormEvent } from 'react';
import { GroupArtwork } from './GroupArtwork';

type Props = {
  name: string;
  nameTouched: boolean;
  busy: boolean;
  onNameChange: (name: string) => void;
  onTouch: () => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
};

export function CreateGroupForm({
  name,
  nameTouched,
  busy,
  onNameChange,
  onTouch,
  onClose,
  onSubmit,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const ideas = useRef<HTMLDetailsElement>(null);
  return (
    <form id="create-group-form" onSubmit={onSubmit} className="mt-3">
      <div className="flex gap-2">
        <input
          ref={input}
          autoFocus
          aria-label="Group name"
          required
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={(event) => {
            if (
              event.relatedTarget instanceof Element &&
              (event.relatedTarget.getAttribute('aria-controls') === 'create-group-form' ||
                event.relatedTarget.closest('.group-ideas'))
            )
              return;
            onTouch();
          }}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          aria-invalid={nameTouched && !name.trim()}
          aria-describedby="group-name-hint"
          placeholder="Tahoe trip, apartment 4B, book club..."
          className={`min-w-0 flex-1 rounded-xl border bg-field px-3.5 py-2.5 outline-none transition focus:ring-2 focus:ring-accent/20 ${
            nameTouched && !name.trim() ? 'border-neg' : 'border-line focus:border-accent'
          }`}
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
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
