import { useState } from 'react';
import type { PnlSection } from '../types';
import { SECTION_LABELS, unionLineKeys, type SegmentPnlResult } from '../lib/segmentAllocation';
import { formatCurrency } from '../lib/format';

export function SegmentPnlDetailTable({ results, showOwnColumn }: { results: SegmentPnlResult[]; showOwnColumn: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const rowKeys = unionLineKeys(results);

  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="py-8 text-center text-sm text-zinc-500">No Segment P&amp;L data for this period.</p>
      </div>
    );
  }

  const lookup = (segment: SegmentPnlResult, section: PnlSection, group: string | null, description: string) =>
    segment.lines.find((l) => l.section === section && l.group === group && l.description === description);

  let lastSection: PnlSection | null = null;
  let lastGroup: string | null | undefined = undefined;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Full Detailed P&amp;L (fully allocated)</h3>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-zinc-500 hover:underline print:hidden dark:text-zinc-400"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {expanded && (
        <div className="max-h-[32rem] overflow-auto print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="py-2 pr-2">Line</th>
                {results.map((r) => (
                  <th key={r.segment} className="py-2 pr-2 text-right">{r.segment}</th>
                ))}
                <th className="py-2 pr-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rowKeys.map((key) => {
                const rows: React.ReactNode[] = [];
                if (key.section !== lastSection) {
                  rows.push(
                    <tr key={`section-${key.section}`} className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/60">
                      <td colSpan={results.length + 2} className="py-1.5 pr-2 font-semibold text-zinc-700 dark:text-zinc-200">
                        {SECTION_LABELS[key.section]}
                      </td>
                    </tr>,
                  );
                  lastSection = key.section;
                  lastGroup = undefined;
                }
                if (key.group !== lastGroup) {
                  if (key.group) {
                    rows.push(
                      <tr key={`group-${key.section}-${key.group}`}>
                        <td colSpan={results.length + 2} className="py-1 pl-3 pr-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          {key.group}
                        </td>
                      </tr>,
                    );
                  }
                  lastGroup = key.group;
                }
                let lineTotal = 0;
                rows.push(
                  <tr key={`${key.section}|${key.group}|${key.description}`} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1 pl-6 pr-2">{key.description}</td>
                    {results.map((r) => {
                      const line = lookup(r, key.section, key.group, key.description);
                      lineTotal += line?.total ?? 0;
                      const hasAllocation = showOwnColumn && !!line && Math.abs(line.allocatedAmount) > 0.0005;
                      return (
                        <td key={r.segment} className="py-1 pr-2 text-right">
                          <span
                            title={
                              hasAllocation
                                ? `Own ${formatCurrency(line!.ownAmount)} + Allocated ${formatCurrency(line!.allocatedAmount)}`
                                : undefined
                            }
                            className={hasAllocation ? 'cursor-help underline decoration-dotted decoration-zinc-300 dark:decoration-zinc-600' : undefined}
                          >
                            {formatCurrency(line?.total ?? 0)}
                          </span>
                        </td>
                      );
                    })}
                    <td className="py-1 pr-2 text-right font-medium">{formatCurrency(lineTotal)}</td>
                  </tr>,
                );
                return rows;
              })}
              <tr className="border-t-2 border-zinc-300 font-semibold dark:border-zinc-600">
                <td className="py-2 pr-2">NET PROFIT / LOSS (fully allocated)</td>
                {results.map((r) => (
                  <td key={r.segment} className="py-2 pr-2 text-right">
                    {formatCurrency(r.allocatedTotals.netProfit)}
                  </td>
                ))}
                <td className="py-2 pr-2 text-right">
                  {formatCurrency(results.reduce((sum, r) => sum + r.allocatedTotals.netProfit, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
