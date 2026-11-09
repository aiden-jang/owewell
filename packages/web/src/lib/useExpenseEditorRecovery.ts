import { useLayoutEffect, useRef } from 'react';
import {
  discardExpenseEditorDraft,
  type ExpenseAttempt,
  type ExpenseEditorDraft,
} from './expenseEditorDraft';

export function useExpenseEditorRecovery(
  key: string | undefined,
  draft: Omit<ExpenseEditorDraft, 'attempt'>,
  restored: ExpenseEditorDraft | null,
) {
  const attempt = useRef<ExpenseAttempt | null>(restored?.attempt ?? null);
  const initial = useRef<string | null>(null);
  const lastSaved = useRef<string | undefined>(restored ? JSON.stringify(restored) : undefined);
  const finished = useRef(false);
  const snapshot = key ? JSON.stringify(draft) : null;

  function rememberAttempt() {
    if (!key || finished.current) return;
    const value = JSON.stringify({ ...draft, attempt: attempt.current });
    try {
      sessionStorage.setItem(key, value);
      lastSaved.current = value;
    } catch {
      // The open editor retains its fields and attempt in memory.
    }
  }

  useLayoutEffect(() => {
    if (snapshot === initial.current) return;
    if (initial.current !== null) rememberAttempt();
    initial.current = snapshot;
  });

  function clearSavedDraft() {
    if (lastSaved.current !== undefined) discardExpenseEditorDraft(key, lastSaved.current);
    lastSaved.current = undefined;
  }

  function finish() {
    finished.current = true;
    clearSavedDraft();
  }

  return { attempt, rememberAttempt, clearSavedDraft, finish };
}
