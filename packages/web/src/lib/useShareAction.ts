import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIRM_MS } from './timing';
import { useAsyncScope } from './useAsyncScope';

/*
 * Handing a line of text to whoever is next to you: try the share sheet, treat a dismissal as a
 * decision rather than a failure, fall back to the clipboard, and say where the text went.
 *
 * Don't drop the AbortError check — without it, backing out of the sheet silently writes to the
 * clipboard. The invite link skips this entirely: it passes a url with no text body, so the sheet's
 * own Copy gives the link rather than a sentence wrapped around it.
 */

/** Null between shares. Drives the button label, which is why 'shared' and 'copied' stay distinct. */
export type ShareStatus = 'sharing' | 'shared' | 'copied' | null;

export function useShareAction(reportFailure: (message: string) => void): {
  status: ShareStatus;
  share: (input: {
    title: string;
    text: string;
    failureMessage: string;
    copyOnly?: boolean;
  }) => Promise<void>;
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
  const { begin, invalidate } = useAsyncScope();

  // The settle-up panel can disappear as soon as the final debt clears.
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
      copyOnly = false,
    }: {
      title: string;
      text: string;
      failureMessage: string;
      copyOnly?: boolean;
    }): Promise<void> => {
      if (busy.current) return;
      const current = begin();
      window.clearTimeout(timer.current);
      busy.current = true;
      setStatus('sharing');
      try {
        if (!copyOnly && navigator.share) {
          try {
            await navigator.share({ title, text });
            if (!current()) return;
            settleBack('shared');
            return;
          } catch (err) {
            if (!current()) return;
            // Backing out of the sheet is an answer, not an error: fall no further, copy nothing.
            if (err instanceof Error && err.name === 'AbortError') {
              setStatus(null);
              return;
            }
          }
        }
        try {
          await navigator.clipboard.writeText(text);
          if (!current()) return;
          settleBack('copied');
        } catch {
          if (!current()) return;
          setStatus(null);
          report.current(failureMessage);
        }
      } finally {
        if (current()) busy.current = false;
      }
    },
    [settleBack, begin],
  );

  const reset = useCallback((): void => {
    invalidate();
    busy.current = false;
    window.clearTimeout(timer.current);
    setStatus(null);
  }, [invalidate]);

  return { status, share, reset };
}
