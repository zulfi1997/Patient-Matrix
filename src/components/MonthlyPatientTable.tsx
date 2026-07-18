import type { MonthlyTrendPoint } from '../lib/metrics';
import { formatMonthLabel, formatNumber, formatPercent } from '../lib/format';

export function MonthlyPatientTable({ data }: { data: MonthlyTrendPoint[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Month-by-Month Patient Activity</h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        New = first-ever visit that month. Repeat = visited that month with an earlier visit on record. Retained =
        of the patients active in the previous month, how many also visited this month.
      </p>

      <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="py-2 pr-2">Month</th>
              <th className="py-2 pr-2 text-right">New</th>
              <th className="py-2 pr-2 text-right">Repeat</th>
              <th className="py-2 pr-2 text-right">Active</th>
              <th className="py-2 pr-2 text-right">Retained</th>
              <th className="py-2 pr-2 text-right">Retention Rate</th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.month} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1.5 pr-2 font-medium">{formatMonthLabel(m.month)}</td>
                <td className="py-1.5 pr-2 text-right text-emerald-600 dark:text-emerald-400">
                  {formatNumber(m.newPatients)}
                </td>
                <td className="py-1.5 pr-2 text-right">{formatNumber(m.returningPatients)}</td>
                <td className="py-1.5 pr-2 text-right">{formatNumber(m.activePatients)}</td>
                <td className="py-1.5 pr-2 text-right">
                  {formatNumber(m.retainedPatients)}
                  {m.prevMonthActivePatients > 0 && (
                    <span className="text-zinc-400"> /{formatNumber(m.prevMonthActivePatients)}</span>
                  )}
                </td>
                <td className="py-1.5 pr-2 text-right font-medium">{formatPercent(m.retentionRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
