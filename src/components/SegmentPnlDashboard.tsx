import { useMemo, useState } from 'react';
import type { PnlImportBatch, PnlLineRecord } from '../types';
import {
  computeSegmentPnl,
  resolveYtdMonths,
  summarizeBatchMonths,
  type SegmentAllocationRule,
} from '../lib/segmentAllocation';
import { formatMonthLabel } from '../lib/format';
import { SegmentPnlSummaryTable } from './SegmentPnlSummaryTable';
import { SegmentPnlDetailTable } from './SegmentPnlDetailTable';

type ViewMode = 'monthly' | 'ytd';

export function SegmentPnlDashboard({
  pnlLines,
  pnlBatches,
  allocationRules,
}: {
  pnlLines: PnlLineRecord[];
  pnlBatches: PnlImportBatch[];
  allocationRules: SegmentAllocationRule[];
}) {
  const availableMonths = useMemo(() => summarizeBatchMonths(pnlBatches), [pnlBatches]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [view, setView] = useState<ViewMode>('monthly');

  const month = selectedMonth || availableMonths[availableMonths.length - 1] || '';

  const segments = useMemo(() => [...new Set(pnlBatches.flatMap((b) => b.segments))].sort(), [pnlBatches]);

  const monthsForView = useMemo(() => {
    if (!month) return [];
    return view === 'monthly' ? [month] : resolveYtdMonths(availableMonths, month);
  }, [month, view, availableMonths]);

  const results = useMemo(
    () => computeSegmentPnl(pnlLines, monthsForView, segments, allocationRules),
    [pnlLines, monthsForView, segments, allocationRules],
  );

  if (availableMonths.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          No Segment P&amp;L data yet. Upload a monthly Zoho Books "Income Statement Segment Wise" export on the{' '}
          <strong>Data</strong> tab to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Month</label>
            <select
              value={month}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="mt-0.5 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {availableMonths.map((m) => (
                <option key={m} value={m}>{formatMonthLabel(m)}</option>
              ))}
            </select>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-xs dark:border-zinc-700">
            <button
              onClick={() => setView('monthly')}
              className={`px-2.5 py-1.5 ${view === 'monthly' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              Month-on-Month
            </button>
            <button
              onClick={() => setView('ytd')}
              className={`px-2.5 py-1.5 ${view === 'ytd' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              Year to Date
            </button>
          </div>
        </div>
        <button
          onClick={() => window.print()}
          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          Export / Print
        </button>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {view === 'monthly' ? (
          <>Showing <strong>{formatMonthLabel(month)}</strong>.</>
        ) : (
          <>
            Showing <strong>Year to Date through {formatMonthLabel(month)}</strong> ({monthsForView.map(formatMonthLabel).join(', ')}).
          </>
        )}{' '}
        Every General ({segments.includes('GEN') ? 'GEN' : 'overhead'}) line item is split by the configured % and merged
        into each segment's own figures below - "fully allocated" means own + that segment's share of GEN.
      </p>

      <SegmentPnlSummaryTable results={results} />
      <SegmentPnlDetailTable results={results} showOwnColumn />
    </div>
  );
}
