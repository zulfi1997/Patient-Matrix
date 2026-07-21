import { computeMonthPatientList, type MonthlyTrendPoint, type PatientVisitSummary } from '../lib/metrics';
import { formatMonthLabel, formatNumber, formatPercent } from '../lib/format';
import type { SaleRecord } from '../types';

function downloadMonthCsv(monthISO: string, records: SaleRecord[], patients: Map<string, PatientVisitSummary>) {
  const rows = computeMonthPatientList(records, patients, monthISO);
  const header = ['Type', 'Patient ID', 'Patient Name', 'First Visit Date', 'Visits This Month', 'Revenue This Month (OMR)'];
  const lines = rows.map((r) =>
    [r.type, r.patientId, r.patientName, r.firstVisitDate, r.visitsThisMonth, r.revenueThisMonth.toFixed(3)]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `patient-activity-${monthISO.slice(0, 7)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function MonthlyPatientTable({
  data,
  records,
  patients,
}: {
  data: MonthlyTrendPoint[];
  records: SaleRecord[];
  patients: Map<string, PatientVisitSummary>;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Month-by-Month Patient Activity</h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        New = first-ever visit that month. Repeat = visited that month with an earlier visit on record. Retained =
        of the patients active in the previous month, how many also visited this month - split into those who were
        themselves new last month vs. already-returning last month. Use "Download" on a row for the actual list of
        who those New/Repeat patients are.
      </p>

      <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="py-2 pr-2">Month</th>
              <th className="py-2 pr-2 text-right">New</th>
              <th className="py-2 pr-2 text-right">Repeat</th>
              <th className="py-2 pr-2 text-right">Active</th>
              <th className="py-2 pr-2 text-right">Retained (total)</th>
              <th className="py-2 pr-2 text-right">New Retained</th>
              <th className="py-2 pr-2 text-right">Returning Retained</th>
              <th className="py-2 pr-2 text-right">Retention Rate</th>
              <th className="py-2 pr-2 print:hidden"></th>
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
                <td className="py-1.5 pr-2 text-right text-indigo-600 dark:text-indigo-400">
                  {formatNumber(m.newPatientsRetained)}
                </td>
                <td className="py-1.5 pr-2 text-right text-sky-600 dark:text-sky-400">
                  {formatNumber(m.returningPatientsRetained)}
                </td>
                <td className="py-1.5 pr-2 text-right font-medium">{formatPercent(m.retentionRate)}</td>
                <td className="py-1.5 pr-2 text-right print:hidden">
                  <button
                    onClick={() => downloadMonthCsv(m.month, records, patients)}
                    className="rounded-lg border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Download
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
