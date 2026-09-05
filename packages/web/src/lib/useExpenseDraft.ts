import { useState, type Dispatch, type SetStateAction } from 'react';
import { DEFAULT_EXPENSE_CATEGORY, type ExpenseCategory } from '@owewell/core';
import type { Expense } from './expenses';
import type { GroupMember } from './groups';
import { todayStr } from './format';

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

/**
 * The state both expense forms hold. They differ only in how the money is entered: one takes a
 * total and a split, the other a list of items.
 *
 * A template keeps today's date while an edit keeps the original's, which is the one place the two
 * prefill sources are not interchangeable.
 */
export function useExpenseDraft(
  members: GroupMember[],
  editing: Expense | undefined,
  template: Expense | undefined,
): Draft {
  const source = editing ?? template;
  const defaultPayer =
    source && members.some((member) => member.userId === source.payerId)
      ? source.payerId
      : (members[0]?.userId ?? '');

  const [description, setDescription] = useState(source?.description ?? '');
  const [payerId, setPayerId] = useState(defaultPayer);
  const [date, setDate] = useState(editing ? editing.date.slice(0, 10) : todayStr());
  const [category, setCategory] = useState<ExpenseCategory>(source?.category ?? DEFAULT_EXPENSE_CATEGORY);
  const [note, setNote] = useState(source?.note ?? '');
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
