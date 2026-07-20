import type { SegmentPnlResult, SegmentPnlTotals } from '../lib/segmentAllocation';
import { formatCurrency } from '../lib/format';

interface SummaryRow {
  label: string;
  own: (t: SegmentPnlTotals) => number;
  total: (t: SegmentPnlTotals) => number;
  emphasize?: boolean;
}

const ROWS: SummaryRow[] = [
  { label: 'Revenue', own: (t) => t.income, total: (t) => t.income },
  { label: 'Cost of Goods Sold', own: (t) => t.cogs, total: (t) => t.cogs },
  { label: 'Gross Profit', own: (t) => t.grossProfit, total: (t) => t.grossProfit, emphasize: true },
  { label: 'Total Expense', own: (t) => t.expense, total: (t) => t.expense },
  { label: 'Other Income', own: (t) => t.otherIncome, total: (t) => t.otherIncome },
  { label: 'Other Expense', own: (t) => t.otherExpense, total: (t) => t.otherExpense },
  { label: 'Net Profit', own: (t) => t.netProfit, total: (t) => t.netProfit, emphasize: true },
];

function Breakdown({ own, total }: { own: number; total: number }) {
  const allocated = total - own;
  return (
    <>
      {formatCurrency(total)}
      {Math.abs(allocated) > 0.0005 && (
        <span className="ml-1 text-xs text-zinc-400">
          ({formatCurrency(own)} + {formatCurrency(allocated)})
        </span>
      )}
    </>
  );
}

export function SegmentPnlSummaryTable({ results }: { results: SegmentPnlResult[] }) {
  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="py-8 text-center text-sm text-zinc-500">No Segment P&amp;L data for this period.</p>
      </div>
    );
  }

  const totalOwn = (get: SummaryRow['own']) => results.reduce((sum, r) => sum + get(r.ownTotals), 0);
  const totalAll = (get: SummaryRow['total']) => results.reduce((sum, r) => sum + get(r.allocatedTotals), 0);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Segment P&amp;L Summary</h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Each figure is the fully-allocated total; where General overhead contributed to it, the breakdown in
        parentheses shows (own + allocated).
      </p>
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="py-2 pr-2">Line</th>
              {results.map((r) => (
                <th key={r.segment} className="py-2 pr-2 text-right">
                  {r.segment} <span className="font-normal normal-case text-zinc-400">(own + alloc.)</span>
                </th>
              ))}
              <th className="py-2 pr-2 text-right">
                Total <span className="font-normal normal-case text-zinc-400">(own + alloc.)</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr
                key={row.label}
                className={`border-t border-zinc-100 dark:border-zinc-800 ${row.emphasize ? 'font-semibold' : ''}`}
              >
                <td className="py-1.5 pr-2">{row.label}</td>
                {results.map((r) => (
                  <td key={r.segment} className="py-1.5 pr-2 text-right">
                    <Breakdown own={row.own(r.ownTotals)} total={row.total(r.allocatedTotals)} />
                  </td>
                ))}
                <td className="py-1.5 pr-2 text-right">
                  <Breakdown own={totalOwn(row.own)} total={totalAll(row.total)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
