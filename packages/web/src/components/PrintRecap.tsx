import { formatMoney as fmt } from '@owewell/shared';
import { createPortal } from 'react-dom';
import { PAYMENT_METHOD_LABELS } from '@owewell/core';
import type { GroupLedger } from '../lib/useGroupLedger';
import { fullDay } from '../lib/relativeTime';
import './print-recap.css';

export function PrintRecap({ ledger }: { ledger: GroupLedger }) {
  const { group, expenses, settlements, balances, pendingCount } = ledger;
  if (!group) return null;
  const nameOf = (id: string) =>
    group.members.find((member) => member.userId === id)?.displayName ?? 'Someone';
  return createPortal(
    <article className="print-recap" aria-label="Printable group recap">
      <header>
        <span>owewell / GROUP RECAP</span>
        <h1>{group.name}</h1>
        <p>
          {group.members.length} people · {expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'} ·{' '}
          {settlements.length} recorded payments
        </p>
      </header>
      <div className="print-recap-total">
        <span>Total expenses</span>
        <strong>{fmt(expenses.reduce((total, expense) => total + expense.amountCents, 0))}</strong>
      </div>
      {pendingCount > 0 && (
        <p className="print-recap-notice">
          {pendingCount} changes are waiting to save on this device. This recap includes saved records only.
        </p>
      )}
      <section>
        <h2>Current balances</h2>
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Status</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((balance) => (
              <tr key={balance.userId}>
                <th scope="row">{nameOf(balance.userId)}</th>
                <td>{balance.netCents > 0 ? 'Is owed' : balance.netCents < 0 ? 'Owes' : 'Settled'}</td>
                <td>{fmt(Math.abs(balance.netCents))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Expenses</h2>
        {expenses.length ? (
          <table>
            <thead>
              <tr>
                <th>Date / expense</th>
                <th>Paid by</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {[...expenses]
                .sort((a, b) => (a.date || a.createdAt).localeCompare(b.date || b.createdAt))
                .map((expense) => (
                  <tr key={expense.id}>
                    <th scope="row">
                      <small>{fullDay(expense.date || expense.createdAt, {})}</small>
                      {expense.description}
                    </th>
                    <td>{nameOf(expense.payerId)}</td>
                    <td>{fmt(expense.amountCents)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <p>No expenses recorded.</p>
        )}
      </section>
      <section>
        <h2>Recorded payments</h2>
        {settlements.length ? (
          <table>
            <thead>
              <tr>
                <th>Date / from → to</th>
                <th>Method</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {[...settlements]
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .map((payment) => (
                  <tr key={payment.id}>
                    <th scope="row">
                      <small>{new Date(payment.createdAt).toLocaleDateString()}</small>
                      {nameOf(payment.fromUserId)} → {nameOf(payment.toUserId)}
                    </th>
                    <td>{payment.method ? PAYMENT_METHOD_LABELS[payment.method] : 'Not specified'}</td>
                    <td>{fmt(payment.amountCents)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <p>No payments recorded.</p>
        )}
      </section>
      <footer>A snapshot of saved records. owewell records payments; it does not move money.</footer>
    </article>,
    document.body,
  );
}
