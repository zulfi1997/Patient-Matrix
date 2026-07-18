import type { DormantServiceStat } from '../lib/metrics';
import { formatCurrency, formatDate, formatNumber } from '../lib/format';

export function DormantServicesTable({ data }: { data: DormantServiceStat[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Services Not Sold Recently</h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Services with a sales history that haven't been sold within the inactivity threshold, sorted by how long
        they've been dormant.
      </p>

      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">
          No dormant services for the selected category — everything has sold recently.
        </p>
      ) : (
        <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="py-2 pr-2">Service</th>
                <th className="py-2 pr-2">Category</th>
                <th className="py-2 pr-2 text-right">Last Sold</th>
                <th className="py-2 pr-2 text-right">Days Inactive</th>
                <th className="py-2 pr-2 text-right">Lifetime Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.serviceKey} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-2">{s.serviceName}</td>
                  <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{s.subcategory}</td>
                  <td className="py-1.5 pr-2 text-right">{formatDate(s.lastSold)}</td>
                  <td className="py-1.5 pr-2 text-right font-medium text-rose-600 dark:text-rose-400">
                    {formatNumber(s.daysInactive)}
                  </td>
                  <td className="py-1.5 pr-2 text-right">{formatCurrency(s.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
