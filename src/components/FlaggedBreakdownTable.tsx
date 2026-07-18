import type { FlaggedBreakdownStat } from '../lib/metrics';
import { formatCurrency, formatNumber } from '../lib/format';

export function FlaggedBreakdownTable({
  title,
  columnLabel,
  data,
}: {
  title: string;
  columnLabel: string;
  data: FlaggedBreakdownStat[];
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{title}</h3>
      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">No flagged transactions in this period.</p>
      ) : (
        <div className="max-h-80 overflow-auto print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="py-2 pr-2">{columnLabel}</th>
                <th className="py-2 pr-2 text-right">Transactions</th>
                <th className="py-2 pr-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.key} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-2">{s.key}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(s.count)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatCurrency(s.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
