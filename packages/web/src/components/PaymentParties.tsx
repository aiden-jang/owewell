import type { GroupMember } from '../lib/groups';
import { inputClass } from './FormFields';

/** Explicit sender and recipient labels remain visible after choosing a name. */
export function PaymentParties({
  members,
  labels,
  from,
  to,
  setFrom,
  setTo,
}: {
  members: GroupMember[];
  labels: Map<string, string>;
  from: string;
  to: string;
  setFrom: (id: string) => void;
  setTo: (id: string) => void;
}) {
  return (
    <div className="payment-parties grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-muted">
        Who paid
        <select
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className={inputClass}
          aria-label="Who paid"
        >
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {labels.get(member.userId) ?? member.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted">
        Paid to
        <select
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className={inputClass}
          aria-label="Paid to"
        >
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {labels.get(member.userId) ?? member.displayName}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
