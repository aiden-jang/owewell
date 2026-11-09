import { useState } from 'react';
import type { SplitMethod } from '@owewell/shared';
import { initialValues } from './expenseSplitHint';
import type { Expense } from './expenses';
import type { GroupMember } from './groups';
import { readSplitPreference } from './splitPreference';
import { readExpenseEditorDraft } from './expenseEditorDraft';
import { useExpenseDraft } from './useExpenseDraft';
import { useExpenseEditorRecovery } from './useExpenseEditorRecovery';

export function useTotalExpenseDraft(
  groupId: string,
  members: GroupMember[],
  editing: Expense | undefined,
  template: Expense | undefined,
  recoveryId: string | undefined,
  draftKey: string | undefined,
) {
  const [stored] = useState(() => readExpenseEditorDraft(draftKey));
  const restored = stored?.input.mode === 'simple' ? stored : null;
  const input = stored?.input.mode === 'simple' ? stored.input : null;
  const fields = useExpenseDraft(members, editing, template, !!recoveryId, restored?.fields);
  const { source, description, payerId, date, category, note } = fields;
  const [preference] = useState(() => readSplitPreference(groupId));
  const memberIds = members.map((member) => member.userId);
  const remembered = preference?.participants.filter((id) => memberIds.includes(id)) ?? [];
  const [amount, setAmount] = useState(
    input?.amount ?? (source ? (source.amountCents / 100).toFixed(2) : ''),
  );
  const [method, setMethod] = useState<SplitMethod>(
    input?.method ??
      (source && source.splitMethod !== 'ITEMIZED' ? source.splitMethod : (preference?.method ?? 'EQUAL')),
  );
  const [selected, setSelected] = useState(
    () =>
      new Set(
        input?.selected ??
          (source
            ? source.splits.map((split) => split.userId).filter((id) => memberIds.includes(id))
            : remembered.length
              ? remembered
              : memberIds),
      ),
  );
  const [values, setValues] = useState<Record<string, string>>(
    () =>
      input?.values ??
      (source
        ? initialValues(source)
        : preference?.method === 'SHARES'
          ? Object.fromEntries(members.map((member) => [member.userId, '1']))
          : {}),
  );
  const baseVersion = restored?.baseVersion ?? editing?.version;
  const recovery = useExpenseEditorRecovery(
    draftKey,
    {
      fields: { description, payerId, date, category, note },
      input: { mode: 'simple', amount, method, selected: [...selected], values },
      baseVersion,
    },
    restored,
  );
  return {
    ...fields,
    amount,
    setAmount,
    method,
    setMethod,
    selected,
    setSelected,
    values,
    setValues,
    baseVersion,
    recovery,
  };
}
