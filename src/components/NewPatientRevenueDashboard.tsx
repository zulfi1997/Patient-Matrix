import { useMemo } from 'react';
import type { SaleRecord } from '../types';
import { computeMonthlyTrend, computeNewPatientDetails, computeNewPatientTopServices, summarizePatients } from '../lib/metrics';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent, toISODate } from '../lib/format';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { KpiCard } from './KpiCard';
import { NewPatientRevenueChart } from './NewPatientRevenueChart';
import { NewPatientRevenueTable } from './NewPatientRevenueTable';
import { NewPatientTopServicesChart } from './NewPatientTopServicesChart';
import { NewPatientsListTable } from './NewPatientsListTable';

const PERIOD_OPTIONS = [3, 6, 12, 24, 36];

export function NewPatientRevenueDashboard({ records }: { records: SaleRecord[] }) {
  const asOfISO = useMemo(() => {
    if (records.length === 0) return toISODate(new Date());
    return records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date);
  }, [records]);

  // How many months of data actually exist, so "All time" and the option list never exceed it.
  const maxMonthsBack = useMemo(() => {
    if (records.length === 0) return 12;
    const minDate = records.reduce((min, r) => (r.date < min ? r.date : min), records[0].date);
    const minD = new Date(`${minDate}T00:00:00`);
    const asOf = new Date(`${asOfISO}T00:00:00`);
    return Math.max((asOf.getFullYear() - minD.getFullYear()) * 12 + (asOf.getMonth() - minD.getMonth()) + 1, 1);
  }, [records, asOfISO]);

  const [monthsBackChoice, setMonthsBackChoice] = useLocalStorageState('pm-npr-months-back', 12);
  const monthsBack = Math.min(monthsBackChoice, maxMonthsBack);

  const patients = useMemo(() => summarizePatients(records), [records]);

  const trend = useMemo(
    () => computeMonthlyTrend(records, patients, monthsBack, asOfISO),
    [records, patients, monthsBack, asOfISO],
  );

  const newPatientDetails = useMemo(
    () => computeNewPatientDetails(records, patients, monthsBack, asOfISO),
    [records, patients, monthsBack, asOfISO],
  );

  const newPatientTopServices = useMemo(
    () => computeNewPatientTopServices(records, patients, monthsBack, asOfISO),
    [records, patients, monthsBack, asOfISO],
  );

  const totals = useMemo(() => {
    const newPatientRevenue = trend.reduce((sum, m) => sum + m.newPatientRevenue, 0);
    const returningPatientRevenue = trend.reduce((sum, m) => sum + m.returningPatientRevenue, 0);
    const totalRevenue = newPatientRevenue + returningPatientRevenue;
    const newPatients = trend.reduce((sum, m) => sum + m.newPatients, 0);
    return {
      newPatientRevenue,
      returningPatientRevenue,
      totalRevenue,
      newPatients,
      sharePct: totalRevenue > 0 ? (newPatientRevenue / totalRevenue) * 100 : null,
    };
  }, [trend]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">New Patient Revenue</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Last {monthsBack} month{monthsBack === 1 ? '' : 's'}, ending {asOfISO}. Shows how much of each month's
            revenue came from patients visiting for the first time that month, versus patients who'd already
            visited before.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Period</label>
          <select
            value={monthsBack}
            onChange={(e) => setMonthsBackChoice(Number(e.target.value))}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            {PERIOD_OPTIONS.filter((m) => m <= maxMonthsBack).map((m) => (
              <option key={m} value={m}>
                Last {m} months
              </option>
            ))}
            <option value={maxMonthsBack}>All time ({maxMonthsBack} months)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="New Patient Revenue"
          value={formatCurrencyCompact(totals.newPatientRevenue)}
          hint={`${formatCurrency(totals.newPatientRevenue)} over last ${monthsBack} months`}
          tone="good"
        />
        <KpiCard
          label="Returning Patient Revenue"
          value={formatCurrencyCompact(totals.returningPatientRevenue)}
          hint={formatCurrency(totals.returningPatientRevenue)}
        />
        <KpiCard label="New Patients" value={formatNumber(totals.newPatients)} hint={`Over last ${monthsBack} months`} />
        <KpiCard
          label="Share From New Patients"
          value={formatPercent(totals.sharePct)}
          hint={`Of total revenue, last ${monthsBack} months`}
        />
      </div>

      <NewPatientRevenueChart data={trend} />
      <NewPatientRevenueTable data={trend} />
      <NewPatientTopServicesChart data={newPatientTopServices} monthsBack={monthsBack} />
      <NewPatientsListTable data={newPatientDetails} monthsBack={monthsBack} />
    </div>
  );
}
