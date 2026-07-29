import { useMemo, useState } from 'react';
import type { ImportBatch, SaleRecord } from '../types';
import { findStaleDuplicateInvoiceLines } from '../lib/duplicateInvoiceLines';
import { formatCurrency, formatDate, formatNumber } from '../lib/format';

export function DuplicateInvoiceLinesPanel({
  records,
  batches,
  onRemove,
}: {
  records: SaleRecord[];
  batches: ImportBatch[];
  onRemove: (ids: string[]) => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);
  const groups = useMemo(() => findStaleDuplicateInvoiceLines(records, batches), [records, batches]);

  if (groups.length === 0) return null;

  const allRemoveIds = groups.flatMap((g) => g.removeIds);
  const totalImpact = groups.reduce((sum, g) => sum + g.removedAmountTotal, 0);

  const handleRemove = async () => {
    if (
      !confirm(
        `Remove ${formatNumber(allRemoveIds.length)} stale duplicate row(s) across ${formatNumber(groups.length)} invoice line(s), reducing revenue by ${formatCurrency(totalImpact)}? The most recently imported version of each line is kept. This cannot be undone.`,
      )
    ) {
      return;
    }
    setRemoving(true);
    try {
      await onRemove(allRemoveIds);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm dark:border-amber-900 dark:bg-amber-950/20">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          Duplicate Invoice Lines Found ({formatNumber(groups.length)})
        </h3>
        <button
          onClick={handleRemove}
          disabled={removing}
          className="rounded-lg border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-300 dark:hover:bg-amber-950/40"
        >
          {removing ? 'Removing…' : `Remove ${formatNumber(allRemoveIds.length)} stale row(s)`}
        </button>
      </div>
      <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
        The same invoice line (matched on invoice + service + quantity + date, since one invoice can carry several
        different services) was captured by more than one upload - typically a manual export and a Zenoti auto-sync
        both covering the same dates, each computing a different row ID for it. Removing the older copy and keeping
        the most recently imported one would reduce total revenue by {formatCurrency(totalImpact)}.
      </p>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-amber-50 text-xs uppercase text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
            <tr>
              <th className="py-2 pr-2">Invoice</th>
              <th className="py-2 pr-2">Service</th>
              <th className="py-2 pr-2 text-right">Date</th>
              <th className="py-2 pr-2 text-right">Keeping</th>
              <th className="py-2 pr-2 text-right">Removing</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.keepIds[0]} className="border-t border-amber-200 dark:border-amber-900">
                <td className="py-1.5 pr-2 font-medium">{g.invoiceNo}</td>
                <td className="py-1.5 pr-2">{g.serviceName}</td>
                <td className="py-1.5 pr-2 text-right">{formatDate(g.date)}</td>
                <td className="py-1.5 pr-2 text-right">
                  {formatCurrency(g.keptAmountTotal)}{' '}
                  <span className="text-amber-600 dark:text-amber-500">
                    ({g.keptStatus}
                    {g.keepIds.length > 1 ? ` × ${g.keepIds.length}` : ''})
                  </span>
                </td>
                <td className="py-1.5 pr-2 text-right text-rose-600 dark:text-rose-400">
                  {g.removedRows.map((r) => `${formatCurrency(r.amount)} (${r.invoiceStatus})`).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
