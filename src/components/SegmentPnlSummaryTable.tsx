import type { SegmentPnlResult } from '../lib/segmentAllocation';
import { formatCurrency } from '../lib/format';

interface SummaryRow {
  label: string;
  get: (r: SegmentPnlResult) => number;
  emphasize?: boolean;
  tone?: 'good' | 'bad';
}

const ROWS: SummaryRow[] = [
  { label: 'Revenue', get: (r) => r.allocatedTotals.income },
  { label: 'Cost of Goods Sold', get: (r) => r.allocatedTotals.cogs },
  { label: 'Gross Profit', get: (r) => r.allocatedTotals.grossProfit, emphasize: true },
  { label: 'Direct Expense (own)', get: (r) => r.ownTotals.expense },
  { label: 'Allocated GEN Overhead', get: (r) => r.allocatedTotals.netProfit - r.ownTotals.netProfit, tone: 'bad' },
  { label: 'Total Expense (fully allocated)', get: (r) => r.allocatedTotals.expense },
  { label: 'Other Income', get: (r) => r.allocatedTotals.otherIncome },
  { label: 'Other Expense', get: (r) => r.allocatedTotals.otherExpense },
  { label: 'Net Profit (own, before allocation)', get: (r) => r.ownTotals.netProfit },
  { label: 'Net Profit (fully allocated)', get: (r) => r.allocatedTotals.netProfit, emphasize: true },
];

export function SegmentPnlSummaryTable({ results }: { results: SegmentPnlResult[] }) {
  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="py-8 text-center text-sm text-zinc-500">No Segment P&amp;L data for this period.</p>
      </div>
    );
  }

  const total = (get: SummaryRow['get']) => results.reduce((sum, r) => sum + get(r), 0);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Segment P&amp;L Summary</h3>
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="py-2 pr-2">Line</th>
              {results.map((r) => (
                <th key={r.segment} className="py-2 pr-2 text-right">{r.segment}</th>
              ))}
              <th className="py-2 pr-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr
                key={row.label}
                className={`border-t border-zinc-100 dark:border-zinc-800 ${row.emphasize ? 'font-semibold' : ''}`}
              >
                <td className="py-1.5 pr-2">{row.label}</td>
                {results.map((r) => {
                  const value = row.get(r);
                  return (
                    <td
                      key={r.segment}
                      className={`py-1.5 pr-2 text-right ${
                        row.tone === 'bad' && value !== 0 ? 'text-rose-600 dark:text-rose-400' : ''
                      }`}
                    >
                      {formatCurrency(value)}
                    </td>
                  );
                })}
                <td className="py-1.5 pr-2 text-right">{formatCurrency(total(row.get))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
