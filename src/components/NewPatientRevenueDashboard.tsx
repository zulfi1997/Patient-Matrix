import { useMemo } from 'react';
import type { SaleRecord } from '../types';
import { computeMonthlyTrend, computeNewPatientDetails, computeNewPatientTopServices, summarizePatients } from '../lib/metrics';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent, toISODate } from '../lib/format';
import { KpiCard } from './KpiCard';
import { NewPatientRevenueChart } from './NewPatientRevenueChart';
import { NewPatientRevenueTable } from './NewPatientRevenueTable';
import { NewPatientTopServicesChart } from './NewPatientTopServicesChart';
import { NewPatientsListTable } from './NewPatientsListTable';

const MONTHS_BACK = 12;

export function NewPatientRevenueDashboard({ records }: { records: SaleRecord[] }) {
  const asOfISO = useMemo(() => {
    if (records.length === 0) return toISODate(new Date());
    return records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date);
  }, [records]);

  const patients = useMemo(() => summarizePatients(records), [records]);

  const trend = useMemo(
    () => computeMonthlyTrend(records, patients, MONTHS_BACK, asOfISO),
    [records, patients, asOfISO],
  );

  const newPatientDetails = useMemo(
    () => computeNewPatientDetails(records, patients, MONTHS_BACK, asOfISO),
    [records, patients, asOfISO],
  );

  const newPatientTopServices = useMemo(
    () => computeNewPatientTopServices(records, patients, MONTHS_BACK, asOfISO),
    [records, patients, asOfISO],
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
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">New Patient Revenue</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Last {MONTHS_BACK} months, ending {asOfISO}. Shows how much of each month's revenue came from patients
          visiting for the first time that month, versus patients who'd already visited before.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="New Patient Revenue"
          value={formatCurrencyCompact(totals.newPatientRevenue)}
          hint={`${formatCurrency(totals.newPatientRevenue)} over last ${MONTHS_BACK} months`}
          tone="good"
        />
        <KpiCard
          label="Returning Patient Revenue"
          value={formatCurrencyCompact(totals.returningPatientRevenue)}
          hint={formatCurrency(totals.returningPatientRevenue)}
        />
        <KpiCard label="New Patients" value={formatNumber(totals.newPatients)} hint={`Over last ${MONTHS_BACK} months`} />
        <KpiCard
          label="Share From New Patients"
          value={formatPercent(totals.sharePct)}
          hint="Of total revenue, last 12 months"
        />
      </div>

      <NewPatientRevenueChart data={trend} />
      <NewPatientRevenueTable data={trend} />
      <NewPatientTopServicesChart data={newPatientTopServices} />
      <NewPatientsListTable data={newPatientDetails} />
    </div>
  );
}
