import { loginUrl } from '@aidenjang/auth-client';
import { AUTH_ORIGIN } from '../lib/api';
import { useEffect, useRef, type ReactNode } from 'react';
import type { GroupMember } from '../lib/groups';

/** The one field skin. Every form on the site reads it, so a change here lands everywhere. */
export const inputClass =
  'w-full rounded-xl border border-line bg-field px-3 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

export function DescriptionField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      enterKeyHint="next"
      placeholder="What was it for?"
      aria-label="What the expense was for"
      required
      className={inputClass}
    />
  );
}

export function PayerSelect({
  members,
  value,
  onChange,
}: {
  members: GroupMember[];
  value: string;
  onChange: (userId: string) => void;
}): ReactNode {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
      aria-label="Paid by"
    >
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.displayName} paid
        </option>
      ))}
    </select>
  );
}

export function DateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Date"
      className={inputClass}
    />
  );
}

/* Optional and unlabelled on purpose: a placeholder is enough for a field nobody has to fill, and a
   label would give it the same weight as the amount. */
export function NoteField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={280}
      placeholder="Add a note (optional)"
      aria-label="Note"
      className={inputClass}
    />
  );
}

export function FormError({ message }: { message: string | null }): ReactNode {
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) errorRef.current?.scrollIntoView?.({ block: 'center' });
  }, [message]);
  if (!message) return null;
  return (
    <p ref={errorRef} className="scroll-mb-24 text-sm font-medium text-neg" role="alert">
      {message}
      {message === 'Your sign-in expired. Sign in again, then retry.' && (
        <span className="mt-2 block text-muted">
          Keep this tab open. Your fields stay here while you sign in.
          <a
            href={loginUrl(AUTH_ORIGIN, window.location.href)}
            target="_blank"
            rel="noopener"
            className="mt-2 block font-semibold text-accent underline underline-offset-4"
          >
            Sign in again (opens a new tab)
          </a>
        </span>
      )}
    </p>
  );
}

export function SubmitButton({
  submitting,
  children,
}: {
  submitting: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="form-submit-bar">
      <button
        type="submit"
        disabled={submitting}
        className="btn-gradient w-full rounded-full px-4 py-3 font-semibold transition active:scale-[0.98] disabled:opacity-60"
      >
        {submitting ? 'Saving…' : children}
      </button>
    </div>
  );
}
