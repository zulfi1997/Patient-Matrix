import { useMemo, useState } from 'react';
import type { ItemType, SaleRecord } from '../types';
import { PRESET_LABELS, resolvePreset, type PresetKey } from '../lib/dateRanges';
import {
  computeAtRiskPatients,
  computeDormantServices,
  computeKpis,
  computeMonthlyTrend,
  computeRedeemedPackages,
  computeServiceStats,
  summarizePatients,
  type DateRange,
} from '../lib/metrics';
import { computeDiscountBreakdown, computeDiscountSummary } from '../lib/discounts';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent, toISODate } from '../lib/format';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { KpiCard } from './KpiCard';
import { PeriodControls } from './PeriodControls';
import { PatientTrendChart } from './PatientTrendChart';
import { RevenueTrendChart } from './RevenueTrendChart';
import { RetainedPatientsChart } from './RetainedPatientsChart';
import { MonthlyPatientTable } from './MonthlyPatientTable';
import { RedeemedPackagesTable } from './RedeemedPackagesTable';
import { DiscountsBreakdownTable } from './DiscountsBreakdownTable';
import { TopServicesChart } from './TopServicesChart';
import { DormantServicesTable } from './DormantServicesTable';
import { AtRiskPatientsTable } from './AtRiskPatientsTable';

const SERVICE_TYPE_OPTIONS: (ItemType | 'All')[] = ['Service', 'Product', 'Package', 'All'];

export function Dashboard({ records }: { records: SaleRecord[] }) {
  const [preset, setPreset] = useLocalStorageState<PresetKey>('pm-preset', 'last30');
  const [customRange, setCustomRange] = useLocalStorageState<DateRange>('pm-custom-range', {
    start: toISODate(new Date(Date.now() - 29 * 86_400_000)),
    end: toISODate(new Date()),
  });
  const [inactivityDays, setInactivityDays] = useLocalStorageState('pm-inactivity-days', 90);
  const [serviceType, setServiceType] = useState<ItemType | 'All'>('Service');

  const asOfISO = useMemo(() => {
    if (records.length === 0) return toISODate(new Date());
    return records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date);
  }, [records]);

  const range = useMemo(() => resolvePreset(preset, asOfISO, customRange), [preset, asOfISO, customRange]);

  const patients = useMemo(() => summarizePatients(records), [records]);

  const kpis = useMemo(
    () => computeKpis(records, range, patients, inactivityDays, asOfISO),
    [records, range, patients, inactivityDays, asOfISO],
  );

  const trend = useMemo(
    () => computeMonthlyTrend(records, patients, 12, asOfISO),
    [records, patients, asOfISO],
  );

  const serviceStats = useMemo(
    () => computeServiceStats(records, range, serviceType),
    [records, range, serviceType],
  );

  const dormantServices = useMemo(
    () => computeDormantServices(records, asOfISO, inactivityDays, serviceType),
    [records, asOfISO, inactivityDays, serviceType],
  );

  const atRiskPatients = useMemo(
    () => computeAtRiskPatients(patients, asOfISO, inactivityDays),
    [patients, asOfISO, inactivityDays],
  );

  const redeemedPackages = useMemo(() => computeRedeemedPackages(records, range), [records, range]);

  const discountSummary = useMemo(() => computeDiscountSummary(records, range), [records, range]);
  const discountBreakdown = useMemo(() => computeDiscountBreakdown(records, range), [records, range]);

  return (
    <div className="flex flex-col gap-4">
      {/* Print-only report header; the on-screen header/nav is hidden when printing. */}
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold text-zinc-900">Patient Matrix — Performance Report</h1>
        <p className="text-xs text-zinc-500">Generated {new Date().toLocaleString('en-GB')}</p>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <PeriodControls
          preset={preset}
          onPresetChange={setPreset}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          inactivityDays={inactivityDays}
          onInactivityDaysChange={setInactivityDays}
        />
        <button
          onClick={() => window.print()}
          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          Export / Print Dashboard
        </button>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Showing <strong>{PRESET_LABELS[preset]}</strong> ({range.start} to {range.end}), compared with the equivalent
        prior period, for category <strong>{serviceType}</strong>, with a {inactivityDays}-day inactivity threshold.
        Data as of {asOfISO}. Gift card/prepaid card purchases themselves aren't revenue (that cash is only
        recognized when redeemed), so those line items are excluded here - but paying for a package, service, or
        product by redeeming a gift/prepaid card still counts as revenue. Only a previously sold package's own
        sessions being consumed is excluded, since that value was already counted as revenue when the package
        itself was sold; that portion is broken out below (see "Redeemed Revenue" and "Redeemed Packages").
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard
          label="Revenue"
          value={formatCurrencyCompact(kpis.periodRevenue)}
          hint={`${formatCurrency(kpis.periodRevenue)} · ${formatNumber(kpis.periodTransactions)} line items`}
        />
        <KpiCard
          label="Redeemed Revenue"
          value={formatCurrencyCompact(kpis.periodRedeemedRevenue)}
          hint={`${formatCurrency(kpis.periodRedeemedRevenue)} · value delivered via package redemption, not new cash`}
        />
        <KpiCard label="Active Patients" value={formatNumber(kpis.activePatients)} />
        <KpiCard label="New Patients" value={formatNumber(kpis.newPatients)} tone="good" />
        <KpiCard label="Returning Patients" value={formatNumber(kpis.returningPatients)} />
        <KpiCard
          label="Retention Rate"
          value={formatPercent(kpis.retentionRate)}
          hint={`${formatNumber(kpis.retainedPatients)} of ${formatNumber(kpis.prevActivePatients)} prior-period patients returned - a fixed period-over-period comparison, not affected by the inactivity threshold below`}
          tone={kpis.retentionRate != null && kpis.retentionRate < 50 ? 'bad' : 'good'}
        />
        <KpiCard
          label="Turnover Rate"
          value={formatPercent(kpis.turnoverRate)}
          hint="Prior-period patients who did not return - also not affected by the inactivity threshold"
          tone={kpis.turnoverRate != null && kpis.turnoverRate > 50 ? 'bad' : 'neutral'}
        />
        <KpiCard
          label="Stopped Visiting"
          value={formatNumber(kpis.stoppedVisiting)}
          hint={`As of today, inactive ${inactivityDays}+ days - this is the number that responds to the threshold above`}
          tone="bad"
        />
        <KpiCard
          label="Total Discount"
          value={formatCurrencyCompact(discountSummary.totalDiscount)}
          hint={`${formatCurrency(discountSummary.totalDiscount)} · manual + campaign + price adjustments, excludes package redemption`}
          tone="bad"
        />
        <KpiCard
          label="Discount %"
          value={formatPercent(discountSummary.discountPct)}
          hint="Total discount as a share of gross (pre-discount) sales this period"
        />
      </div>

      <RedeemedPackagesTable data={redeemedPackages} />

      <DiscountsBreakdownTable data={discountBreakdown} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 print:grid-cols-1">
        <PatientTrendChart data={trend} />
        <RevenueTrendChart data={trend} />
      </div>

      <RetainedPatientsChart data={trend} />

      <MonthlyPatientTable data={trend} />

      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm print:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Category:</span>
        <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-xs dark:border-zinc-700">
          {SERVICE_TYPE_OPTIONS.map((t) => (
            <button
              key={t}
              onClick={() => setServiceType(t)}
              className={`px-2.5 py-1 ${serviceType === t ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 print:grid-cols-1">
        <TopServicesChart data={serviceStats} />
        <DormantServicesTable data={dormantServices} />
      </div>

      <AtRiskPatientsTable data={atRiskPatients} />
    </div>
  );
}
