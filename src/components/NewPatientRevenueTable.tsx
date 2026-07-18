import type { MonthlyTrendPoint } from '../lib/metrics';
import { formatCurrency, formatMonthLabel, formatNumber, formatPercent } from '../lib/format';

export function NewPatientRevenueTable({ data }: { data: MonthlyTrendPoint[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Month-by-Month Revenue by Patient Type</h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        New Patient Revenue = revenue that month from patients visiting for the first time ever that month. Returning
        Patient Revenue = revenue that month from everyone else.
      </p>

      <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="py-2 pr-2">Month</th>
              <th className="py-2 pr-2 text-right">New Patients</th>
              <th className="py-2 pr-2 text-right">New Patient Revenue</th>
              <th className="py-2 pr-2 text-right">Returning Patient Revenue</th>
              <th className="py-2 pr-2 text-right">Total Revenue</th>
              <th className="py-2 pr-2 text-right">% From New Patients</th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.month} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1.5 pr-2 font-medium">{formatMonthLabel(m.month)}</td>
                <td className="py-1.5 pr-2 text-right text-emerald-600 dark:text-emerald-400">
                  {formatNumber(m.newPatients)}
                </td>
                <td className="py-1.5 pr-2 text-right">{formatCurrency(m.newPatientRevenue)}</td>
                <td className="py-1.5 pr-2 text-right">{formatCurrency(m.returningPatientRevenue)}</td>
                <td className="py-1.5 pr-2 text-right font-medium">{formatCurrency(m.revenue)}</td>
                <td className="py-1.5 pr-2 text-right">
                  {formatPercent(m.revenue > 0 ? (m.newPatientRevenue / m.revenue) * 100 : null)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
