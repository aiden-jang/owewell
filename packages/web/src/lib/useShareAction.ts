import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIRM_MS } from './timing';

/*
 * Handing a line of text to whoever is standing next to you: try the share sheet, treat a dismissed
 * sheet as a decision rather than a failure, fall back to the clipboard, and say where the text went.
 *
 * Don't drop the AbortError check. Without it, backing out of the share sheet silently writes to
 * the clipboard instead.
 *
 * The invite link is the one share that skips this: it passes a url with no text body, so the
 * sheet's own Copy copies the link rather than a sentence wrapped around it. Nothing here ever
 * downloads — the clipboard is the right fallback for text going into a group chat.
 */

/** Null between shares. Drives the button label, which is why 'shared' and 'copied' stay distinct. */
export type ShareStatus = 'sharing' | 'shared' | 'copied' | null;

export function useShareAction(reportFailure: (message: string) => void): {
  status: ShareStatus;
  share: (input: { title: string; text: string; failureMessage: string }) => Promise<void>;
  /** Drop the confirmation early, for a surface that reopens somewhere else before it fades. */
  reset: () => void;
} {
  const [status, setStatus] = useState<ShareStatus>(null);
  // Held in refs so a caller passing an inline arrow (or a toast api rebuilt each render) does not
  // change the identity of `share` on every render.
  const report = useRef(reportFailure);
  report.current = reportFailure;
  const busy = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  // The old copies left their timer running. Nothing broke, because the component that owned the
  // state was usually still mounted, but a settle-up panel that disappears the moment the last debt
  // clears is exactly the case where it was not.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const settleBack = useCallback((landed: 'shared' | 'copied'): void => {
    setStatus(landed);
    timer.current = window.setTimeout(() => setStatus(null), CONFIRM_MS);
  }, []);

  const share = useCallback(
    async ({
      title,
      text,
      failureMessage,
    }: {
      title: string;
      text: string;
      failureMessage: string;
    }): Promise<void> => {
      if (busy.current) return;
      busy.current = true;
      setStatus('sharing');
      try {
        if (navigator.share) {
          try {
            await navigator.share({ title, text });
            settleBack('shared');
            return;
          } catch (err) {
            // Backing out of the sheet is an answer, not an error: fall no further, copy nothing.
            if (err instanceof Error && err.name === 'AbortError') {
              setStatus(null);
              return;
            }
          }
        }
        try {
          await navigator.clipboard.writeText(text);
          settleBack('copied');
        } catch {
          setStatus(null);
          report.current(failureMessage);
        }
      } finally {
        busy.current = false;
      }
    },
    [settleBack],
  );

  const reset = useCallback((): void => {
    window.clearTimeout(timer.current);
    setStatus(null);
  }, []);

  return { status, share, reset };
}
