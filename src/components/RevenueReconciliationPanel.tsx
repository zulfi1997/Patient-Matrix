import { useMemo, useState } from 'react';
import type { ImportBatch, SaleRecord } from '../types';
import { computeRevenueReconciliation } from '../lib/revenueReconciliation';
import type { DateRange } from '../lib/metrics';
import { formatCurrency, formatDate, formatNumber } from '../lib/format';

export function RevenueReconciliationPanel({
  rawRecords,
  batches,
  range,
  excludeFlagged,
  excludeZeroValue,
}: {
  rawRecords: SaleRecord[];
  batches: ImportBatch[];
  range: DateRange;
  excludeFlagged: boolean;
  excludeZeroValue: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rec = useMemo(
    () => computeRevenueReconciliation(rawRecords, batches, range, { excludeFlagged, excludeZeroValue }),
    [rawRecords, batches, range, excludeFlagged, excludeZeroValue],
  );

  const multipleImports = rec.contributions.length > 1;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm print:hidden dark:border-zinc-800 dark:bg-zinc-900">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
      >
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          Reconcile Revenue to Source
          <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
            {formatCurrency(rec.sourceGross)} gross across {formatNumber(rec.sourceRows)} row(s) →{' '}
            {formatCurrency(rec.revenue)} revenue + {formatCurrency(rec.redeemed)} redeemed
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {rec.supersededRows > 0 && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {formatNumber(rec.supersededRows)} double-counted
            </span>
          )}
          <span className="text-xs text-zinc-500">{open ? 'Hide' : 'Show'}</span>
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-zinc-100 p-4 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Every step between the rows stored for {formatDate(range.start)} – {formatDate(range.end)} and the Revenue
            and Redeemed Revenue figures above. "Gross" is Sales (Exc. Tax) as your source report states it, so the top
            line is what you can compare directly against that report.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-2">Step</th>
                  <th className="py-2 pr-2 text-right">Rows Removed</th>
                  <th className="py-2 pr-2 text-right">Gross Removed</th>
                  <th className="py-2 pr-2 text-right">Rows Left</th>
                  <th className="py-2 pr-2 text-right">Gross Left</th>
                </tr>
              </thead>
              <tbody>
                {rec.stages.map((s) => (
                  <tr key={s.label} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                    <td className="py-1.5 pr-2">
                      <span className={s.inactive ? 'text-zinc-400 dark:text-zinc-500' : ''}>{s.label}</span>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">{s.note}</div>
                    </td>
                    <td className="py-1.5 pr-2 text-right">{s.rowsRemoved > 0 ? formatNumber(s.rowsRemoved) : '—'}</td>
                    <td className="py-1.5 pr-2 text-right">
                      {s.grossRemoved !== 0 ? formatCurrency(s.grossRemoved) : '—'}
                    </td>
                    <td className="py-1.5 pr-2 text-right">{formatNumber(s.rows)}</td>
                    <td className="py-1.5 pr-2 text-right font-medium">{formatCurrency(s.gross)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-zinc-300 dark:border-zinc-700">
                  <td className="py-1.5 pr-2 font-semibold">
                    Shown as Revenue + Redeemed Revenue
                    <div className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                      Sales (Exc. Tax) minus the portion redeemed from a previously sold package, plus that redeemed
                      portion reported separately.
                    </div>
                  </td>
                  <td className="py-1.5 pr-2" />
                  <td className="py-1.5 pr-2" />
                  <td className="py-1.5 pr-2 text-right font-semibold">{formatNumber(rec.finalRows)}</td>
                  <td className="py-1.5 pr-2 text-right font-semibold">
                    {formatCurrency(rec.revenue)} + {formatCurrency(rec.redeemed)}
                    <div className="text-xs font-normal text-zinc-500">= {formatCurrency(rec.finalGross)}</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
              Which imports these rows came from
            </h4>
            {multipleImports ? (
              <p className="mb-2 text-xs text-rose-600 dark:text-rose-400">
                More than one import supplies rows for these dates. Where they overlap the same day, those rows are
                counted twice - the figure above is inflated by that much. Anything marked below as already restated by
                a later import can be cleared from the Data tab.
              </p>
            ) : (
              <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                A single import supplies these dates, so there is no overlap inflating the total.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                  <tr>
                    <th className="py-2 pr-2">Import</th>
                    <th className="py-2 pr-2">Uploaded</th>
                    <th className="py-2 pr-2 text-right">Rows</th>
                    <th className="py-2 pr-2 text-right">Gross</th>
                    <th className="py-2 pr-2 text-right">Already Restated Later</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.contributions.map((c) => (
                    <tr key={c.batchId} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5 pr-2">{c.fileName}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
                        {c.uploadedAt ? new Date(c.uploadedAt).toLocaleString('en-GB') : '—'}
                      </td>
                      <td className="py-1.5 pr-2 text-right">{formatNumber(c.rows)}</td>
                      <td className="py-1.5 pr-2 text-right">{formatCurrency(c.gross)}</td>
                      <td className="py-1.5 pr-2 text-right">
                        {c.supersededRows > 0 ? (
                          <span className="text-rose-600 dark:text-rose-400">
                            {formatNumber(c.supersededRows)} row(s) · {formatCurrency(c.supersededGross)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
