import type { RedeemedPackageStat } from '../lib/metrics';
import { formatCurrency, formatNumber } from '../lib/format';

export function RedeemedPackagesTable({ data }: { data: RedeemedPackageStat[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Redeemed Packages</h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Sessions redeemed this period from previously purchased packages (identified from the Payment Type column),
        by package. This value is already excluded from Revenue above.
      </p>

      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">No package redemptions in this period.</p>
      ) : (
        <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="py-2 pr-2">Package</th>
                <th className="py-2 pr-2 text-right">Times Redeemed</th>
                <th className="py-2 pr-2 text-right">Redeemed Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.packageName} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-2">{p.packageName}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(p.count)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatCurrency(p.redeemedAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
