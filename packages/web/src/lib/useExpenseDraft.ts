import { useState, type Dispatch, type SetStateAction } from 'react';
import { DEFAULT_EXPENSE_CATEGORY, type ExpenseCategory } from '@owewell/core';
import type { Expense } from './expenses';
import type { GroupMember } from './groups';
import { todayStr } from './format';
import type { ExpenseDraftFields } from './expenseEditorDraft';

interface Draft {
  /** The expense being edited or copied, whichever the caller passed. */
  source: Expense | undefined;
  /** Seeds the top-level payer, and in the itemized form each new line item's payer too. */
  defaultPayer: string;
  description: string;
  setDescription: Dispatch<SetStateAction<string>>;
  payerId: string;
  setPayerId: Dispatch<SetStateAction<string>>;
  date: string;
  setDate: Dispatch<SetStateAction<string>>;
  category: ExpenseCategory;
  setCategory: Dispatch<SetStateAction<ExpenseCategory>>;
  note: string;
  setNote: Dispatch<SetStateAction<string>>;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  submitting: boolean;
  setSubmitting: Dispatch<SetStateAction<boolean>>;
}

/** Templates use today; edits retain the saved expense date. */
export function useExpenseDraft(
  members: GroupMember[],
  editing: Expense | undefined,
  template: Expense | undefined,
  recovering?: boolean,
  restored?: ExpenseDraftFields,
): Draft {
  const source = editing ?? template;
  const defaultPayer =
    source && (recovering || members.some((member) => member.userId === source.payerId))
      ? source.payerId
      : (members[0]?.userId ?? '');

  const [description, setDescription] = useState(restored?.description ?? source?.description ?? '');
  const [payerId, setPayerId] = useState(restored?.payerId ?? defaultPayer);
  const [date, setDate] = useState(
    restored?.date ?? (editing || recovering ? source?.date.slice(0, 10) || todayStr() : todayStr()),
  );
  const [category, setCategory] = useState<ExpenseCategory>(
    restored?.category ?? source?.category ?? DEFAULT_EXPENSE_CATEGORY,
  );
  const [note, setNote] = useState(restored?.note ?? source?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return {
    source,
    defaultPayer,
    description,
    setDescription,
    payerId,
    setPayerId,
    date,
    setDate,
    category,
    setCategory,
    note,
    setNote,
    error,
    setError,
    submitting,
    setSubmitting,
  };
}
