import { useMemo, useState } from 'react';
import type { CollectionAttributionOverride, CollectionRecord, PackageBenefitRecord, SaleRecord } from '../types';
import {
  buildInvoiceToPatientMap,
  computeConversionTrend,
  computeDailyConversion,
  computeRangeConversion,
  CONVERSION_CATEGORY_LABELS as CATEGORY_LABELS,
  FOLLOW_UP_REASON_LABELS,
  SNAPSHOT_STALENESS_CAP_DAYS,
  type ProviderAssignmentOverride,
  type ProviderConversionStat,
  type ProviderGroup,
  type RevenueAdjustment,
} from '../lib/conversionMetrics';
import { summarizePatients, type DateRange } from '../lib/metrics';
import { PRESET_LABELS, resolvePreset, type PresetKey } from '../lib/dateRanges';
import { formatCurrencyCompact, formatDate, formatNumber, formatPercent, toISODate } from '../lib/format';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { KpiCard } from './KpiCard';
import { ConversionTrendChart } from './ConversionTrendChart';
import { PeriodPresetSelect } from './PeriodPresetSelect';
import { ProviderHandoverPanel } from './ProviderHandoverPanel';
import { ExportExcelButton } from './ExportExcelButton';
import { conversionSheets, contextSheet } from '../lib/dashboardExports';
import {
  buildCardOnlyInvoices,
  buildInvoiceProviderShares,
  cashCollectedFor,
  computeProviderCollections,
  invoiceNumberRanges,
  salesDateSpan,
} from '../lib/collections';

const TREND_DAYS = 30;
type ViewMode = 'day' | 'period';

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

function exportProviderSummaryCsv(providers: ProviderConversionStat[], overall: ProviderConversionStat, periodLabel: string) {
  const header = [
    'Provider', 'New Unconverted', 'New Converted', 'Total New Patients',
    'Repeat Unconverted', 'Repeat Converted', 'Total Repeat Patients',
    'Follow-up / Direct Service', 'Total Patients', 'Conversion Rate (%)', 'Revenue',
  ];
  const rows = [...providers, { ...overall, staff: 'All Providers' }];
  const lines = rows.map((p) =>
    [
      p.staff,
      p.newUnconverted, p.newConverted, p.newUnconverted + p.newConverted,
      p.repeatUnconverted, p.repeatConverted, p.repeatUnconverted + p.repeatConverted,
      p.followUp, p.total, p.conversionRate != null ? p.conversionRate.toFixed(1) : '',
      p.revenue.toFixed(3),
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `provider-conversion-${periodLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ProviderConversionDashboard({
  records,
  packageBenefits,
  providerGroups,
  revenueAdjustments,
  providerAssignmentOverrides,
  collections,
  collectionAttributionOverrides,
  rawRecords,
}: {
  records: SaleRecord[];
  packageBenefits: PackageBenefitRecord[];
  providerGroups: ProviderGroup[];
  revenueAdjustments: RevenueAdjustment[];
  providerAssignmentOverrides: ProviderAssignmentOverride[];
  collections: CollectionRecord[];
  collectionAttributionOverrides: CollectionAttributionOverride[];
  /** Unfiltered stored rows - collection attribution must see gift/prepaid-card invoices, which the analysis filters drop. */
  rawRecords: SaleRecord[];
}) {
  const asOfISO = useMemo(() => {
    if (records.length === 0) return toISODate(new Date());
    return records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date);
  }, [records]);
  const minDate = useMemo(() => {
    if (records.length === 0) return asOfISO;
    return records.reduce((min, r) => (r.date < min ? r.date : min), records[0].date);
  }, [records, asOfISO]);

  const [viewMode, setViewMode] = useLocalStorageState<ViewMode>('pm-conversion-view-mode', 'day');
  const [date, setDate] = useLocalStorageState('pm-conversion-date', asOfISO);
  const [preset, setPreset] = useLocalStorageState<PresetKey>('pm-conversion-preset', 'thisMonth');
  const [customRange, setCustomRange] = useLocalStorageState<DateRange>('pm-conversion-custom-range', {
    start: toISODate(new Date(Date.now() - 29 * 86_400_000)),
    end: toISODate(new Date()),
  });
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const clampedDate = date > asOfISO ? asOfISO : date < minDate ? minDate : date;
  const periodRange: DateRange = useMemo(() => resolvePreset(preset, asOfISO, customRange), [preset, asOfISO, customRange]);

  const patients = useMemo(() => summarizePatients(records), [records]);
  const invoiceToPatient = useMemo(() => buildInvoiceToPatientMap(records), [records]);

  const packageBenefitsByDate = useMemo(() => {
    const map = new Map<string, PackageBenefitRecord[]>();
    for (const b of packageBenefits) {
      if (!map.has(b.snapshotDate)) map.set(b.snapshotDate, []);
      map.get(b.snapshotDate)!.push(b);
    }
    return map;
  }, [packageBenefits]);

  // Both view modes normalize to the same shape (a single day is just a 1-day range) so the
  // rest of the dashboard doesn't need to branch on viewMode at all.
  const summary = useMemo(() => {
    if (viewMode === 'day') {
      const daily = computeDailyConversion(
        records,
        patients,
        clampedDate,
        invoiceToPatient,
        packageBenefitsByDate,
        providerGroups,
        revenueAdjustments,
        providerAssignmentOverrides,
      );
      return {
        range: { start: clampedDate, end: clampedDate },
        daysWithExactSnapshot: daily.snapshotUsed?.daysAway === 0 ? 1 : 0,
        daysWithFallbackSnapshot: daily.snapshotUsed && daily.snapshotUsed.daysAway > 0 ? 1 : 0,
        totalDays: 1,
        snapshotUsed: daily.snapshotUsed,
        providers: daily.providers,
        overall: daily.overall,
        patientRows: daily.patientRows,
      };
    }
    return computeRangeConversion(
      records,
      patients,
      periodRange,
      invoiceToPatient,
      packageBenefitsByDate,
      providerGroups,
      revenueAdjustments,
      providerAssignmentOverrides,
    );
  }, [
    viewMode,
    records,
    patients,
    clampedDate,
    periodRange,
    invoiceToPatient,
    packageBenefitsByDate,
    providerGroups,
    revenueAdjustments,
    providerAssignmentOverrides,
  ]);

  const trendDays = useMemo(() => {
    const days: string[] = [];
    let d = addDays(asOfISO, -(TREND_DAYS - 1));
    if (d < minDate) d = minDate;
    while (d <= asOfISO) {
      days.push(d);
      d = addDays(d, 1);
    }
    return days;
  }, [asOfISO, minDate]);

  const trend = useMemo(
    () =>
      computeConversionTrend(
        records,
        patients,
        invoiceToPatient,
        packageBenefitsByDate,
        trendDays,
        providerGroups,
        revenueAdjustments,
        providerAssignmentOverrides,
      ),
    [records, patients, invoiceToPatient, packageBenefitsByDate, trendDays, providerGroups, revenueAdjustments, providerAssignmentOverrides],
  );

  const staffOptions = useMemo(() => summary.providers.map((p) => p.staff), [summary.providers]);

  // By collection date, not sale date - the point of the column is when the money arrived. Shares
  // come from the full sales history, since a payment here often settles an older invoice.
  const collectionSummary = useMemo(() => {
    if (collections.length === 0) return null;
    const shares = buildInvoiceProviderShares(rawRecords, providerGroups, providerAssignmentOverrides, collectionAttributionOverrides);
    return computeProviderCollections(collections, shares, summary.range, salesDateSpan(rawRecords), invoiceNumberRanges(rawRecords), buildCardOnlyInvoices(rawRecords));
  }, [collections, rawRecords, providerGroups, providerAssignmentOverrides, collectionAttributionOverrides, summary.range]);

  /**
   * Adjustments only apply to the dates they carry, so in Single Day mode - the default, on the
   * latest date in the data - a correction made for any other day simply is not in view. Silence
   * there reads as "the adjustment did nothing", which is the wrong conclusion, so say it plainly.
   */
  const adjustmentsOutOfView = useMemo(() => {
    const inView = revenueAdjustments.filter((a) => a.date >= summary.range.start && a.date <= summary.range.end);
    return { total: revenueAdjustments.length, shown: inView.length };
  }, [revenueAdjustments, summary.range]);

  const filteredPatientRows = useMemo(
    () =>
      summary.patientRows.filter(
        (r) => (staffFilter === 'all' || r.staff === staffFilter) && (categoryFilter === 'all' || r.category === categoryFilter),
      ),
    [summary.patientRows, staffFilter, categoryFilter],
  );

  const periodLabel =
    viewMode === 'day' ? formatDate(clampedDate) : `${PRESET_LABELS[preset]} (${formatDate(summary.range.start)} – ${formatDate(summary.range.end)})`;

  const { daysWithExactSnapshot, daysWithFallbackSnapshot, totalDays } = summary;
  const daysCovered = daysWithExactSnapshot + daysWithFallbackSnapshot;
  const daysMissing = totalDays - daysCovered;

  const snapshotBadge: { tone: 'good' | 'estimate' | 'warn'; text: string } =
    daysWithExactSnapshot === totalDays
      ? {
          tone: 'good',
          text: totalDays === 1 ? 'Package balance snapshot available for this date' : `Package balance snapshot available for all ${totalDays} days in this period`,
        }
      : daysMissing === 0
        ? {
            tone: 'estimate',
            text:
              totalDays === 1 && summary.snapshotUsed
                ? `No snapshot for this exact date - using the ${formatDate(summary.snapshotUsed.snapshotDate)} snapshot (${summary.snapshotUsed.daysAway}d away) as an estimate`
                : `${daysWithFallbackSnapshot} of ${totalDays} days used the nearest available snapshot (within ${SNAPSHOT_STALENESS_CAP_DAYS} days) as an estimate`,
          }
        : daysCovered === 0
          ? {
              tone: 'warn',
              text:
                totalDays === 1
                  ? `No package balance snapshot within ${SNAPSHOT_STALENESS_CAP_DAYS} days of this date - $0-revenue repeat visits with a real package balance may show as "Repeat Unconverted"`
                  : `No package balance snapshots within ${SNAPSHOT_STALENESS_CAP_DAYS} days of this period - $0-revenue repeat visits with a real package balance may show as "Repeat Unconverted"`,
            }
          : {
              tone: 'warn',
              text: `${daysCovered} of ${totalDays} days have a usable snapshot (exact or nearby estimate) - the other ${daysMissing} day(s) may show "Repeat Unconverted" instead of Follow-up`,
            };

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold text-zinc-900">Patient Matrix — Provider Conversion Report</h1>
        <p className="text-xs text-zinc-500">Generated {new Date().toLocaleString('en-GB')}</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 print:hidden">Provider Conversion</h2>
          <p className="max-w-3xl text-xs text-zinc-500 dark:text-zinc-400">
            Per provider, per day: a first-ever visit with revenue that day is <strong>New Converted</strong>, with no
            revenue is <strong>New Unconverted</strong>. A repeat visit with revenue that day is{' '}
            <strong>Repeat Converted</strong>; with no revenue and no package redemption or package benefit balance,
            it's <strong>Repeat Unconverted</strong>. A repeat visit with no revenue that came for a package
            redemption or has a package benefit balance, or any "YB111"-flagged visit, falls under{' '}
            <strong>Follow-up/Direct Service</strong> - never counted as a conversion opportunity. Conversion Rate =
            (New Converted + Repeat Converted) / (New Unconverted + New Converted + Repeat Unconverted + Repeat
            Converted). A period is the sum of each day's own classification. Assisting nurses' invoices, temporary
            reassignments (e.g. covering for a doctor on leave), and manual Revenue corrections can all be configured
            under <strong>Master Control</strong> on the Data tab.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 print:hidden dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          Export / Print Dashboard
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-sm dark:border-zinc-700">
          <button
            onClick={() => setViewMode('day')}
            className={`px-3 py-1.5 ${viewMode === 'day' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
          >
            Single Day
          </button>
          <button
            onClick={() => setViewMode('period')}
            className={`px-3 py-1.5 ${viewMode === 'period' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
          >
            Period
          </button>
        </div>

        {viewMode === 'day' ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setDate(addDays(clampedDate, -1))}
              disabled={clampedDate <= minDate}
              className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              ← Prev day
            </button>
            <input
              type="date"
              value={clampedDate}
              min={minDate}
              max={asOfISO}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              onClick={() => setDate(addDays(clampedDate, 1))}
              disabled={clampedDate >= asOfISO}
              className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Next day →
            </button>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{formatDate(clampedDate)}</span>
          </div>
        ) : (
          <PeriodPresetSelect preset={preset} onPresetChange={setPreset} customRange={customRange} onCustomRangeChange={setCustomRange} />
        )}

        <span
          className={`ml-auto rounded-full px-2.5 py-1 text-xs font-medium ${
            snapshotBadge.tone === 'good'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
              : snapshotBadge.tone === 'estimate'
                ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
          }`}
        >
          {snapshotBadge.text}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Total Patients"
          value={formatNumber(summary.overall.total)}
          help="Every patient-provider visit in the selected period/day, across all five categories below (one row per patient seen by a given provider on a given day)."
        />
        <KpiCard
          label="New Unconverted"
          value={formatNumber(summary.overall.newUnconverted)}
          help="Patient's very first-ever visit, but it produced no revenue that day (e.g. a free consultation with nothing purchased)."
          tone="bad"
        />
        <KpiCard
          label="New Converted"
          value={formatNumber(summary.overall.newConverted)}
          help="Patient's very first-ever visit, and it produced revenue that day (a consultation that turned into a sale)."
          tone="good"
        />
        <KpiCard
          label="Repeat Unconverted"
          value={formatNumber(summary.overall.repeatUnconverted)}
          help={`Not the patient's first visit, no revenue that day, and not explained by a package redemption, an outstanding package balance, or a "YB111" flag - a repeat visit that didn't convert into a new sale.`}
          tone="bad"
        />
        <KpiCard
          label="Repeat Converted"
          value={formatNumber(summary.overall.repeatConverted)}
          help="Not the patient's first visit, and it produced revenue that day - a returning patient buying something new."
          tone="good"
        />
        <KpiCard
          label="Follow-up / Direct Service"
          value={formatNumber(summary.overall.followUp)}
          help={`Visits excluded from the conversion math because they're expected to show no new revenue: redeeming a previously-sold package, a patient with a remaining package balance, or a "YB111"-flagged line item.`}
        />
        <KpiCard
          label="Conversion Rate"
          value={formatPercent(summary.overall.conversionRate, 1)}
          help="(New Converted + Repeat Converted) ÷ (New Unconverted + New Converted + Repeat Unconverted + Repeat Converted) - Follow-up / Direct Service visits are excluded from both the top and bottom of this ratio."
          tone="neutral"
        />
        <KpiCard
          label="Revenue"
          value={formatCurrencyCompact(summary.overall.revenue)}
          help="Total revenue (Sales Exc. Tax) across every visit shown above, for the selected period/day."
        />
      </div>

      {adjustmentsOutOfView.total > adjustmentsOutOfView.shown && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 print:hidden dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {adjustmentsOutOfView.shown} of {adjustmentsOutOfView.total} Revenue Adjustments fall inside{' '}
          {viewMode === 'day' ? 'this date' : 'this period'}. The rest are dated elsewhere and are not reflected in the
          Revenue column above - an adjustment applies only on the day it carries.
          {viewMode === 'day' && ' Switch to Period to cover a range of dates.'}
        </p>
      )}

      <ConversionTrendChart data={trend} />

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">By Provider / Therapist - {periodLabel}</h3>
          <ExportExcelButton
            label="Export to Excel"
            fileName={`provider-conversion-${viewMode === 'day' ? date : `${periodRange.start}-to-${periodRange.end}`}.xlsx`}
            disabled={summary.providers.length === 0}
            buildSheets={() => [
              contextSheet([
                ['Report', 'Provider Conversion'],
                ['Scope', viewMode === 'day' ? `Single day: ${date}` : `${periodRange.start} to ${periodRange.end}`],
                ['Currency', 'OMR. Amounts are numbers, not text, so they pivot and sum directly.'],
                ['Conversion rate', 'Converted divided by everyone classified as a conversion opportunity. Follow-up / direct-service visits are excluded from that denominator, since there was nothing to convert.'],
                ['Provider', 'Canonical name after Provider Groups and date-scoped overrides, so an assisting nurse counts under whichever doctor she assisted that day.'],
                ['Classification', 'Each patient is classified once per provider per day, on that day\'s own terms.'],
                ...(collectionSummary
                  ? ([['Collected (Cash)', 'Money actually received in this window, by collection date rather than sale date, on invoices the provider sold. Package, gift-card and prepaid-card settlements are excluded - that cash arrived when the package or card was bought. It will not tie to Revenue, and is not meant to.']] as [string, string][])
                  : []),
              ]),
              ...conversionSheets({
                providers: summary.providers, overall: summary.overall, patientRows: summary.patientRows,
                categoryLabels: CATEGORY_LABELS, followUpLabels: FOLLOW_UP_REASON_LABELS,
              }),
            ]}
          />
          <button
            onClick={() => exportProviderSummaryCsv(summary.providers, summary.overall, periodLabel)}
            disabled={summary.providers.length === 0}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 print:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Export by Provider (CSV)
          </button>
        </div>
        {summary.providers.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No visits recorded for this {viewMode === 'day' ? 'date' : 'period'}.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[13%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[6%]" />
                <col className="w-[10%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead className="text-[10px] uppercase leading-tight text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="break-words py-2 pr-2 align-bottom">Provider / Therapist</th>
                  <th className="break-words py-2 pr-2 text-right align-bottom">New Unconverted</th>
                  <th className="break-words py-2 pr-2 text-right align-bottom">New Converted</th>
                  <th className="break-words py-2 pr-2 text-right align-bottom">Total New Patients</th>
                  <th className="break-words py-2 pr-2 text-right align-bottom">Repeat Unconverted</th>
                  <th className="break-words py-2 pr-2 text-right align-bottom">Repeat Converted</th>
                  <th className="break-words py-2 pr-2 text-right align-bottom">Total Repeat Patients</th>
                  <th className="break-words py-2 pr-2 text-right align-bottom">Follow-up / Direct Service</th>
                  <th className="break-words py-2 pr-2 text-right align-bottom">Total</th>
                  <th className="break-words py-2 pr-2 text-right align-bottom">Conversion Rate</th>
                  <th className="break-words py-2 pr-2 text-right align-bottom">Revenue</th>
                  {collectionSummary && <th className="break-words py-2 pr-2 text-right align-bottom">Net Collection</th>}
                </tr>
              </thead>
              <tbody>
                {summary.providers.map((p) => {
                  const reasonBreakdown = (Object.keys(p.followUpByReason) as (keyof typeof p.followUpByReason)[])
                    .filter((r) => p.followUpByReason[r] > 0)
                    .map((r) => `${FOLLOW_UP_REASON_LABELS[r]}: ${p.followUpByReason[r]}`)
                    .join(', ');
                  return (
                    <tr key={p.staff} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5 pr-2 font-medium break-words">{p.staff}</td>
                      <td className="py-1.5 pr-2 text-right text-rose-600 dark:text-rose-400">{formatNumber(p.newUnconverted)}</td>
                      <td className="py-1.5 pr-2 text-right text-emerald-600 dark:text-emerald-400">{formatNumber(p.newConverted)}</td>
                      <td className="py-1.5 pr-2 text-right font-medium">{formatNumber(p.newUnconverted + p.newConverted)}</td>
                      <td className="py-1.5 pr-2 text-right text-rose-600 dark:text-rose-400">{formatNumber(p.repeatUnconverted)}</td>
                      <td className="py-1.5 pr-2 text-right text-emerald-600 dark:text-emerald-400">{formatNumber(p.repeatConverted)}</td>
                      <td className="py-1.5 pr-2 text-right font-medium">{formatNumber(p.repeatUnconverted + p.repeatConverted)}</td>
                      <td className="py-1.5 pr-2 text-right" title={reasonBreakdown || undefined}>
                        {formatNumber(p.followUp)}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-medium">{formatNumber(p.total)}</td>
                      <td className="py-1.5 pr-2 text-right font-medium">{formatPercent(p.conversionRate, 1)}</td>
                      <td
                        className="py-1.5 pr-2 text-right"
                        title={p.revenueAdjustment !== 0 ? `Includes a Master Control adjustment of ${p.revenueAdjustment > 0 ? '+' : ''}${formatNumber(p.revenueAdjustment)}` : undefined}
                      >
                        {formatNumber(p.revenue)}
                        {p.revenueAdjustment !== 0 && (
                          <span className="ml-1 text-zinc-400">
                            ({p.revenueAdjustment > 0 ? '+' : ''}
                            {formatNumber(p.revenueAdjustment)})
                          </span>
                        )}
                      </td>
                      {collectionSummary && (
                        <td className="py-1.5 pr-2 text-right text-sky-700 dark:text-sky-400">
                          {formatNumber(cashCollectedFor(collectionSummary, p.staff))}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-200 font-semibold dark:border-zinc-700">
                  <td className="py-1.5 pr-2">All Providers</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.newUnconverted)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.newConverted)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.newUnconverted + summary.overall.newConverted)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.repeatUnconverted)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.repeatConverted)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.repeatUnconverted + summary.overall.repeatConverted)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.followUp)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.total)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatPercent(summary.overall.conversionRate, 1)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.revenue)}</td>
                  {collectionSummary && (
                    <td className="py-1.5 pr-2 text-right text-sky-700 dark:text-sky-400">
                      {formatNumber(collectionSummary.totalNetCollected)}
                    </td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {collectionSummary && collectionSummary.unattributedCollected + collectionSummary.unattributedRefunded !== 0 && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            {formatNumber(collectionSummary.unattributedCollected + collectionSummary.unattributedRefunded)} of the collected total is on{' '}
            {formatNumber(collectionSummary.unattributedPayments)} payment(s) whose invoice is not in your sales data -
            usually an invoice raised before the earliest sales file you have imported. It is inside the All Providers
            total but sits in no provider's row.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Patient Detail - {periodLabel}</h3>
          <div className="flex gap-2 print:hidden">
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="all">All Providers</option>
              {staffOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="all">All Categories</option>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                {viewMode === 'period' && <th className="py-2 pr-2">Date</th>}
                <th className="py-2 pr-2">Patient</th>
                <th className="py-2 pr-2">Provider</th>
                <th className="py-2 pr-2">Category</th>
                <th className="py-2 pr-2">Reason</th>
                <th className="py-2 pr-2 text-right">Revenue</th>
                <th className="py-2 pr-2">Services</th>
              </tr>
            </thead>
            <tbody>
              {filteredPatientRows.length === 0 ? (
                <tr>
                  <td colSpan={viewMode === 'period' ? 7 : 6} className="py-6 text-center text-sm text-zinc-500">No patients match this filter.</td>
                </tr>
              ) : (
                filteredPatientRows.map((r) => (
                  <tr key={`${r.date}-${r.patientId}-${r.staff}`} className="border-t border-zinc-100 dark:border-zinc-800">
                    {viewMode === 'period' && <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{formatDate(r.date)}</td>}
                    <td className="py-1.5 pr-2">{r.patientName}</td>
                    <td className="py-1.5 pr-2">{r.staff}</td>
                    <td className="py-1.5 pr-2">{CATEGORY_LABELS[r.category]}</td>
                    <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">
                      {r.followUpReason ? FOLLOW_UP_REASON_LABELS[r.followUpReason] : '—'}
                    </td>
                    <td className="py-1.5 pr-2 text-right">{formatNumber(r.revenue)}</td>
                    <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{r.services.join(', ')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ProviderHandoverPanel
        records={records}
        asOfISO={asOfISO}
        providerGroups={providerGroups}
        providerAssignmentOverrides={providerAssignmentOverrides}
      />
    </div>
  );
}
