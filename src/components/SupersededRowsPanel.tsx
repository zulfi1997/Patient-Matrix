import { useMemo, useState } from 'react';
import type { ImportBatch, SaleRecord } from '../types';
import { findSupersededRows } from '../lib/supersededRows';
import { formatCurrency, formatDate, formatNumber } from '../lib/format';

export function SupersededRowsPanel({
  records,
  batches,
  onRemove,
}: {
  records: SaleRecord[];
  batches: ImportBatch[];
  onRemove: (ids: string[]) => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);
  const summary = useMemo(() => findSupersededRows(records, batches), [records, batches]);

  if (summary.rowCount === 0) return null;

  const handleRemove = async () => {
    if (
      !confirm(
        `Remove ${formatNumber(summary.rowCount)} row(s) that later imports have already restated?\n\n` +
          `Revenue will drop by ${formatCurrency(summary.revenueImpact)} and package redemption by ` +
          `${formatCurrency(summary.redeemedImpact)}, removing the double-counting - and any invoice ` +
          `voided in Zenoti since the older import will stop being counted.\n\n` +
          `This cannot be undone. Use "Backup all data (CSV)" first if you want a copy.`,
      )
    ) {
      return;
    }
    setRemoving(true);
    try {
      await onRemove(summary.removeIds);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm dark:border-amber-900 dark:bg-amber-950/20">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          Older Rows Already Restated by a Later Import ({formatNumber(summary.rowCount)})
        </h3>
        <button
          onClick={handleRemove}
          disabled={removing}
          className="rounded-lg border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-300 dark:hover:bg-amber-950/40"
        >
          {removing ? 'Removing…' : `Remove ${formatNumber(summary.rowCount)} superseded row(s)`}
        </button>
      </div>
      <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
        A sales export restates every day it covers, so where a later import re-covers the same dates its version is
        authoritative. These rows predate such an import and are being counted <em>on top of</em> it, inflating Revenue
        by {formatCurrency(summary.revenueImpact)} and package redemption by {formatCurrency(summary.redeemedImpact)}.
        Removing them also retires any invoice voided in Zenoti after the older import - those never appear in the newer
        export, so nothing else can retire them. New imports apply this automatically; this covers data already stored.
      </p>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-amber-50 text-xs uppercase text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
            <tr>
              <th className="py-2 pr-2">Authoritative Import</th>
              <th className="py-2 pr-2">Covers</th>
              <th className="py-2 pr-2">Superseded Rows From</th>
              <th className="py-2 pr-2 text-right">Rows</th>
              <th className="py-2 pr-2 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {summary.groups.map((g) => (
              <tr key={g.batchId} className="border-t border-amber-200 dark:border-amber-900">
                <td className="py-1.5 pr-2 font-medium">{g.fileName}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  {formatDate(g.dateRange.min)} – {formatDate(g.dateRange.max)}
                </td>
                <td className="py-1.5 pr-2 text-xs text-amber-700 dark:text-amber-400">
                  {g.fromBatches.map((f) => `${f.fileName} (${formatNumber(f.rowCount)})`).join(', ')}
                </td>
                <td className="py-1.5 pr-2 text-right">{formatNumber(g.rowCount)}</td>
                <td className="py-1.5 pr-2 text-right text-rose-600 dark:text-rose-400">
                  {formatCurrency(g.revenueImpact)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
