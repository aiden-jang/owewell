import type { ExpenseEditDifference } from '../lib/expenseEditDifferences';

export function ExpenseEditComparison({ rows }: { rows: ExpenseEditDifference[] }) {
  return (
    <table className="mt-4 w-full table-fixed border-collapse text-left text-sm">
      <caption className="sr-only">What changed</caption>
      <thead className="border-b border-line text-xs text-muted">
        <tr>
          <th scope="col" className="py-2 pr-2 font-medium">
            Change
          </th>
          <th scope="col" className="px-2 py-2 font-medium">
            In the ledger
          </th>
          <th scope="col" className="py-2 pl-2 font-medium">
            Your edit
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map(({ label, ledger, edit }, index) => (
          <tr key={index} className="align-top [overflow-wrap:anywhere]">
            <th scope="row" className="py-2 pr-2 font-medium">
              {label}
            </th>
            <td className="tnum px-2 py-2 whitespace-pre-wrap text-muted">{ledger}</td>
            <td className="tnum py-2 pl-2 whitespace-pre-wrap">{edit}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
