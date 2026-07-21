import { useMemo } from 'react';
import type { PnlLineRecord, SaleRecord } from '../types';
import { PRESET_LABELS, resolvePreset, type PresetKey } from '../lib/dateRanges';
import {
  computeMonthlyTrend,
  computeNewPatientDetails,
  computeNewPatientRevenueSummary,
  computeNewPatientTopServices,
  summarizePatients,
  type DateRange,
} from '../lib/metrics';
import { computeAcquisitionCostInputs, wholeMonthsTouching } from '../lib/acquisitionCost';
import { formatCurrency, formatCurrencyCompact, formatMonthLabel, formatNumber, formatPercent, toISODate } from '../lib/format';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { KpiCard } from './KpiCard';
import { PeriodPresetSelect } from './PeriodPresetSelect';
import { NewPatientRevenueChart } from './NewPatientRevenueChart';
import { NewPatientRevenueTable } from './NewPatientRevenueTable';
import { NewPatientTopServicesChart } from './NewPatientTopServicesChart';
import { NewPatientsListTable } from './NewPatientsListTable';

const TREND_MONTHS_BACK = 12;

export function NewPatientRevenueDashboard({ records, pnlLines }: { records: SaleRecord[]; pnlLines: PnlLineRecord[] }) {
  const [preset, setPreset] = useLocalStorageState<PresetKey>('pm-npr-preset', 'thisMonth');
  const [customRange, setCustomRange] = useLocalStorageState<DateRange>('pm-npr-custom-range', {
    start: toISODate(new Date(Date.now() - 29 * 86_400_000)),
    end: toISODate(new Date()),
  });

  const asOfISO = useMemo(() => {
    if (records.length === 0) return toISODate(new Date());
    return records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date);
  }, [records]);

  const range = useMemo(() => resolvePreset(preset, asOfISO, customRange), [preset, asOfISO, customRange]);

  const patients = useMemo(() => summarizePatients(records), [records]);

  // The chart/table below stay on a fixed rolling 12-month view for trend context,
  // same as the main Dashboard's trend charts - only the KPIs and lists are period-scoped.
  const trend = useMemo(
    () => computeMonthlyTrend(records, patients, TREND_MONTHS_BACK, asOfISO),
    [records, patients, asOfISO],
  );

  const summary = useMemo(
    () => computeNewPatientRevenueSummary(records, patients, range),
    [records, patients, range],
  );

  const newPatientDetails = useMemo(
    () => computeNewPatientDetails(records, patients, range),
    [records, patients, range],
  );

  const newPatientTopServices = useMemo(
    () => computeNewPatientTopServices(records, patients, range),
    [records, patients, range],
  );

  // Segment P&L data is monthly-only, so Patient Acquisition Cost is aligned to the full
  // calendar month(s) the selected period touches, rather than the exact (possibly partial)
  // range above - otherwise a whole month's marketing spend would get compared against a
  // partial month's new-patient count.
  const touchedMonths = useMemo(() => wholeMonthsTouching(range), [range]);
  const acquisitionInputs = useMemo(
    () => computeAcquisitionCostInputs(pnlLines, touchedMonths),
    [pnlLines, touchedMonths],
  );
  const pacNewPatients = useMemo(
    () =>
      acquisitionInputs.effectiveRange
        ? computeNewPatientRevenueSummary(records, patients, acquisitionInputs.effectiveRange).newPatients
        : 0,
    [records, patients, acquisitionInputs.effectiveRange],
  );
  const pacAdCampaigns = pacNewPatients > 0 ? acquisitionInputs.adCampaignSpend / pacNewPatients : null;
  const pacTotalMarketing = pacNewPatients > 0 ? acquisitionInputs.totalMarketingSpend / pacNewPatients : null;
  const monthsCoveredLabel = acquisitionInputs.monthsCovered.map(formatMonthLabel).join(', ');

  const sharePct = summary.totalRevenue > 0 ? (summary.newPatientRevenue / summary.totalRevenue) * 100 : null;
  const periodLabel = `${PRESET_LABELS[preset]} (${range.start} to ${range.end})`;

  return (
    <div className="flex flex-col gap-4">
      {/* Print-only report header; the on-screen header/nav is hidden when printing. */}
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold text-zinc-900">Patient Matrix — New Patient Revenue Report</h1>
        <p className="text-xs text-zinc-500">Generated {new Date().toLocaleString('en-GB')}</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 print:hidden">New Patient Revenue</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Showing {periodLabel}. Data as of {asOfISO}.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <PeriodPresetSelect
              preset={preset}
              onPresetChange={setPreset}
              customRange={customRange}
              onCustomRangeChange={setCustomRange}
            />
          </div>
          <button
            onClick={() => window.print()}
            className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            Export / Print Dashboard
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="New Patient Revenue"
          value={formatCurrencyCompact(summary.newPatientRevenue)}
          hint={formatCurrency(summary.newPatientRevenue)}
          help="Revenue from patients whose very first-ever visit fell within the selected period."
          tone="good"
        />
        <KpiCard
          label="Returning Patient Revenue"
          value={formatCurrencyCompact(summary.returningPatientRevenue)}
          hint={formatCurrency(summary.returningPatientRevenue)}
          help="Revenue from patients who had already visited before the selected period started."
        />
        <KpiCard
          label="New Patients"
          value={formatNumber(summary.newPatients)}
          help="Distinct patients whose very first-ever visit fell within the selected period."
        />
        <KpiCard
          label="Share From New Patients"
          value={formatPercent(sharePct)}
          hint="Of revenue, this period"
          help="New Patient Revenue as a % of total revenue (new + returning) this period."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiCard
          label="Patient Acquisition Cost (Ad Campaigns)"
          value={acquisitionInputs.monthsCovered.length > 0 ? formatCurrencyCompact(pacAdCampaigns ?? 0) : '—'}
          hint={
            acquisitionInputs.monthsCovered.length === 0
              ? 'No Segment P&L data for this period - upload monthly P&L exports on the Data tab.'
              : `${formatCurrency(acquisitionInputs.adCampaignSpend)} Social Media Add Campaigns spend ÷ ${formatNumber(pacNewPatients)} new patients, ${monthsCoveredLabel}`
          }
          help="Social Media Ad Campaigns spend (from the Segment P&L upload) for the whole calendar month(s) touched by the selected period, divided by new patients in that same full-month window - not the exact partial period above, since a month's ad spend shouldn't be compared against a partial month's new patients."
          tone="bad"
        />
        <KpiCard
          label="Patient Acquisition Cost (Total Marketing)"
          value={acquisitionInputs.monthsCovered.length > 0 ? formatCurrencyCompact(pacTotalMarketing ?? 0) : '—'}
          hint={
            acquisitionInputs.monthsCovered.length === 0
              ? 'No Segment P&L data for this period - upload monthly P&L exports on the Data tab.'
              : `${formatCurrency(acquisitionInputs.totalMarketingSpend)} total Marketing and Promotion spend ÷ ${formatNumber(pacNewPatients)} new patients, ${monthsCoveredLabel}`
          }
          help="Same as the Ad Campaigns figure, but using total Marketing and Promotion spend (all campaigns, not just Social Media Ad Campaigns) for the whole calendar month(s) touched by the selected period."
          tone="bad"
        />
      </div>

      <NewPatientRevenueChart data={trend} />
      <NewPatientRevenueTable data={trend} />
      <NewPatientTopServicesChart data={newPatientTopServices} periodLabel={periodLabel} />
      <NewPatientsListTable data={newPatientDetails} periodLabel={periodLabel} />
    </div>
  );
}
