import { computeGroupTotals, unionGroups, type SegmentPnlResult, type SegmentPnlTotals } from '../lib/segmentAllocation';
import { formatCurrency } from '../lib/format';

interface SummaryRow {
  label: string;
  own: (r: SegmentPnlResult) => number;
  total: (r: SegmentPnlResult) => number;
  emphasize?: boolean;
  indent?: boolean;
}

function totalsRow(label: string, pick: (t: SegmentPnlTotals) => number, emphasize?: boolean): SummaryRow {
  return { label, own: (r) => pick(r.ownTotals), total: (r) => pick(r.allocatedTotals), emphasize };
}

function Breakdown({ own, total }: { own: number; total: number }) {
  const allocated = total - own;
  const hasAllocation = Math.abs(allocated) > 0.0005;
  return (
    <span
      title={hasAllocation ? `Own ${formatCurrency(own)} + Allocated ${formatCurrency(allocated)}` : undefined}
      className={hasAllocation ? 'cursor-help underline decoration-dotted decoration-zinc-300 dark:decoration-zinc-600' : undefined}
    >
      {formatCurrency(total)}
    </span>
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

  const expenseGroups = unionGroups(results, 'expense');
  const rows: SummaryRow[] = [
    totalsRow('Revenue', (t) => t.income),
    totalsRow('Cost of Goods Sold', (t) => t.cogs),
    totalsRow('Gross Profit', (t) => t.grossProfit, true),
    ...expenseGroups.map(
      (group): SummaryRow => ({
        label: group,
        own: (r) => computeGroupTotals(r, 'expense').get(group)?.own ?? 0,
        total: (r) => computeGroupTotals(r, 'expense').get(group)?.total ?? 0,
        indent: true,
      }),
    ),
    totalsRow('Total Expense', (t) => t.expense, true),
    totalsRow('Other Income', (t) => t.otherIncome),
    totalsRow('Other Expense', (t) => t.otherExpense),
    totalsRow('Net Profit', (t) => t.netProfit, true),
  ];

  const totalOwn = (get: SummaryRow['own']) => results.reduce((sum, r) => sum + get(r), 0);
  const totalAll = (get: SummaryRow['total']) => results.reduce((sum, r) => sum + get(r), 0);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Segment P&amp;L Summary</h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Each figure is the fully-allocated total; where General overhead contributed to it, hover a dotted-underlined
        figure for the own + allocated breakdown. Expense is broken down by cost center below.
      </p>
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
            {rows.map((row) => (
              <tr
                key={row.label}
                className={`border-t border-zinc-100 dark:border-zinc-800 ${row.emphasize ? 'font-semibold' : ''}`}
              >
                <td className={`py-1.5 pr-2 ${row.indent ? 'pl-4 text-xs text-zinc-500 dark:text-zinc-400' : ''}`}>{row.label}</td>
                {results.map((r) => (
                  <td key={r.segment} className="py-1.5 pr-2 text-right">
                    <Breakdown own={row.own(r)} total={row.total(r)} />
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
