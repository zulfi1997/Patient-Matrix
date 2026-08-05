import { useMemo, useState } from 'react';
import type { CollectionRecord, ImportBatch, ItemType, SaleRecord } from '../types';
import { PRESET_LABELS, resolvePreset, type PresetKey } from '../lib/dateRanges';
import {
  computeAgingBucketSummary,
  computeAtRiskPatients,
  computeDormantServices,
  computeInvoiceAging,
  computeKpis,
  computeMonthlyTrend,
  computeRedeemedPackages,
  computeReturnedPatients,
  computeServiceStats,
  summarizePatients,
  type DateRange,
} from '../lib/metrics';
import { computeDiscountBreakdown, computeDiscountDetails, computeDiscountSummary } from '../lib/discounts';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent, toISODate } from '../lib/format';
import { exportDashboardPptx } from '../lib/pptxExport';
import type { DeckConfig } from '../lib/deckSections';
import { DeckBuilder } from './DeckBuilder';
import { exportDashboardWorkbook } from '../lib/excelExport';
import type { ProviderAssignmentOverride, ProviderGroup, RevenueAdjustment } from '../lib/conversionMetrics';
import { computeProviderRevenueByType } from '../lib/providerRevenueByType';
import { buildInvoiceProviderShares, computeProviderCollections } from '../lib/collections';
import { ProviderRevenueByTypeTable } from './ProviderRevenueByTypeTable';
import { RevenueReconciliationPanel } from './RevenueReconciliationPanel';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { KpiCard } from './KpiCard';
import { PeriodControls } from './PeriodControls';
import { PatientTrendChart } from './PatientTrendChart';
import { RevenueTrendChart } from './RevenueTrendChart';
import { RetainedPatientsChart } from './RetainedPatientsChart';
import { MonthlyPatientTable } from './MonthlyPatientTable';
import { RedeemedPackagesTable } from './RedeemedPackagesTable';
import { DiscountsBreakdownTable } from './DiscountsBreakdownTable';
import { DiscountDetailsTable } from './DiscountDetailsTable';
import { TopServicesChart } from './TopServicesChart';
import { DormantServicesTable } from './DormantServicesTable';
import { AtRiskPatientsTable } from './AtRiskPatientsTable';
import { ReturnedPatientsTable } from './ReturnedPatientsTable';
import { InvoiceAgingSection } from './InvoiceAgingSection';

const SERVICE_TYPE_OPTIONS: (ItemType | 'All')[] = ['Service', 'Product', 'Package', 'All'];

export function Dashboard({
  records,
  rawRecords,
  batches,
  excludeFlagged,
  excludeZeroValue,
  providerGroups,
  providerAssignmentOverrides,
  revenueAdjustments,
  collections,
}: {
  records: SaleRecord[];
  /** Unfiltered stored rows, so the reconciliation panel can show what the pipeline excludes. */
  rawRecords: SaleRecord[];
  batches: ImportBatch[];
  excludeFlagged: boolean;
  excludeZeroValue: boolean;
  providerGroups: ProviderGroup[];
  providerAssignmentOverrides: ProviderAssignmentOverride[];
  revenueAdjustments: RevenueAdjustment[];
  collections: CollectionRecord[];
}) {
  const [preset, setPreset] = useLocalStorageState<PresetKey>('pm-preset', 'last30');
  const [customRange, setCustomRange] = useLocalStorageState<DateRange>('pm-custom-range', {
    start: toISODate(new Date(Date.now() - 29 * 86_400_000)),
    end: toISODate(new Date()),
  });
  const [inactivityDays, setInactivityDays] = useLocalStorageState('pm-inactivity-days', 90);
  const [serviceType, setServiceType] = useState<ItemType | 'All'>('Service');
  const [deckOpen, setDeckOpen] = useState(false);
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const [xlsxError, setXlsxError] = useState<string | null>(null);

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

  const returnedPatients = useMemo(
    () => computeReturnedPatients(records, patients, inactivityDays, asOfISO),
    [records, patients, inactivityDays, asOfISO],
  );

  const redeemedPackages = useMemo(() => computeRedeemedPackages(records, range), [records, range]);

  const revenueByType = useMemo(
    () => computeProviderRevenueByType(records, range, providerGroups, providerAssignmentOverrides, revenueAdjustments),
    [records, range, providerGroups, providerAssignmentOverrides, revenueAdjustments],
  );

  // Built from every record rather than the period's: a payment received in this period often
  // settles an invoice raised before it, and narrowing first would leave that payment unattributed.
  const invoiceShares = useMemo(
    () => buildInvoiceProviderShares(records, providerGroups, providerAssignmentOverrides),
    [records, providerGroups, providerAssignmentOverrides],
  );

  const collectionSummary = useMemo(
    () => (collections.length === 0 ? null : computeProviderCollections(collections, invoiceShares, range)),
    [collections, invoiceShares, range],
  );

  const discountSummary = useMemo(() => computeDiscountSummary(records, range), [records, range]);
  const discountBreakdown = useMemo(() => computeDiscountBreakdown(records, range), [records, range]);
  const discountDetails = useMemo(() => computeDiscountDetails(records, range), [records, range]);

  const invoiceAging = useMemo(() => computeInvoiceAging(records, asOfISO), [records, asOfISO]);
  const agingBucketSummary = useMemo(() => computeAgingBucketSummary(invoiceAging), [invoiceAging]);

  const downloadWorkbook = async () => {
    setXlsxBusy(true);
    setXlsxError(null);
    try {
      await exportDashboardWorkbook({
        periodLabel: PRESET_LABELS[preset],
        range, asOfISO, inactivityDays, serviceType,
        kpis, discountSummary, discountBreakdown, discountDetails,
        trend, services: serviceStats, redeemedPackages, revenueByType,
        invoiceAging, agingBucketSummary,
        atRiskPatients, returnedPatients,
        records, patients, providerGroups, providerAssignmentOverrides,
        collectionSummary,
      });
    } catch (e) {
      setXlsxError(e instanceof Error ? e.message : 'Failed to build the workbook.');
    } finally {
      setXlsxBusy(false);
    }
  };

  const buildDeck = async (config: DeckConfig) => {
    await exportDashboardPptx(
      {
        periodLabel: PRESET_LABELS[preset],
        rangeStart: range.start,
        rangeEnd: range.end,
        asOfISO,
        inactivityDays,
        serviceType,
        kpis,
        discountSummary,
        discountBreakdown,
        trend,
        topServices: serviceStats,
        redeemedPackages,
        invoiceAging,
        agingBucketSummary,
        atRiskCount: atRiskPatients.length,
        returnedPatients,
      },
      config,
    );
  };

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
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Export / Print Dashboard
            </button>
            <button
              onClick={downloadWorkbook}
              disabled={xlsxBusy}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {xlsxBusy ? 'Building…' : 'Export to Excel'}
            </button>
            <button
              onClick={() => setDeckOpen((v) => !v)}
              className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              {deckOpen ? 'Hide Presentation Builder' : 'Build Presentation'}
            </button>
          </div>
          {xlsxError && <p className="max-w-xs text-right text-xs text-rose-600 dark:text-rose-400">{xlsxError}</p>}
        </div>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Showing <strong>{PRESET_LABELS[preset]}</strong> ({range.start} to {range.end}), compared with the equivalent
        prior period, for category <strong>{serviceType}</strong>, with a {inactivityDays}-day inactivity threshold.
        Data as of {asOfISO}. Gift and prepaid cards are a means of payment rather than a sale in themselves, so
        buying one is never revenue and those line items are excluded here - the revenue is recognized on the
        invoice the card later pays for, and that invoice counts in full however it was settled. Only a previously sold package's own
        sessions being consumed is excluded, since that value was already counted as revenue when the package
        itself was sold; that portion is broken out below (see "Redeemed Revenue" and "Redeemed Packages").
      </p>

      {deckOpen && (
        <DeckBuilder
          defaultTitle="Patient Matrix"
          defaultSubtitle="Performance Review"
          onBuild={buildDeck}
          onClose={() => setDeckOpen(false)}
        />
      )}

      <RevenueReconciliationPanel
        rawRecords={rawRecords}
        batches={batches}
        range={range}
        excludeFlagged={excludeFlagged}
        excludeZeroValue={excludeZeroValue}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard
          label="Revenue"
          value={formatCurrencyCompact(kpis.periodRevenue)}
          hint={`${formatCurrency(kpis.periodRevenue)} · ${formatNumber(kpis.periodTransactions)} line items`}
          help="Sales (Exc. Tax) for the selected period, minus any portion redeemed from a previously sold package - that redeemed value is broken out separately below so it isn't counted as new revenue twice."
        />
        <KpiCard
          label="Redeemed Revenue"
          value={formatCurrencyCompact(kpis.periodRedeemedRevenue)}
          hint={`${formatCurrency(kpis.periodRedeemedRevenue)} · value delivered via package redemption, not new cash`}
          help="Value of previously-sold package sessions used up this period. It's already counted as revenue at the time the package itself was sold, so it's shown separately here rather than added into Revenue above."
        />
        <KpiCard
          label="Active Patients"
          value={formatNumber(kpis.activePatients)}
          help="Distinct patients with at least one visit (line item) during the selected period."
        />
        <KpiCard
          label="New Patients"
          value={formatNumber(kpis.newPatients)}
          tone="good"
          help="Active patients this period whose very first-ever visit fell within the selected period."
        />
        <KpiCard
          label="Returning Patients"
          value={formatNumber(kpis.returningPatients)}
          help="Active patients this period who had already visited at least once before the period started."
        />
        <KpiCard
          label="Retention Rate"
          value={formatPercent(kpis.retentionRate)}
          hint={`${formatNumber(kpis.retainedPatients)} of ${formatNumber(kpis.prevActivePatients)} prior-period patients returned - a fixed period-over-period comparison, not affected by the inactivity threshold below`}
          help="Of the patients active in the prior equivalent period, the % who also visited in the selected period. A period-over-period comparison, unrelated to the inactivity threshold below."
          tone={kpis.retentionRate != null && kpis.retentionRate < 50 ? 'bad' : 'good'}
        />
        <KpiCard
          label="Turnover Rate"
          value={formatPercent(kpis.turnoverRate)}
          hint="Prior-period patients who did not return - also not affected by the inactivity threshold"
          help="Of the patients active in the prior equivalent period, the % who did not visit again in the selected period - the inverse of Retention Rate."
          tone={kpis.turnoverRate != null && kpis.turnoverRate > 50 ? 'bad' : 'neutral'}
        />
        <KpiCard
          label="Stopped Visiting"
          value={formatNumber(kpis.stoppedVisiting)}
          hint={`As of today, inactive ${inactivityDays}+ days - this is the number that responds to the threshold above`}
          help='Patients with no visit in the last N days (set via the "Stopped visiting after" dropdown above), measured as of today - not scoped to the selected period.'
          tone="bad"
        />
        <KpiCard
          label="Total Discount"
          value={formatCurrencyCompact(discountSummary.totalDiscount)}
          hint={`${formatCurrency(discountSummary.totalDiscount)} · every discount except package redemption`}
          help="Every discount given this period - manual, campaign (e.g. Buy 1 Get 1 Free), price adjustments, and any other named or unnamed discount. Package redemption is the one exclusion: it isn't a discount, just the value of a previously-sold package session being consumed, which is reported separately as Redeemed Revenue."
          tone="bad"
        />
        <KpiCard
          label="Discount %"
          value={formatPercent(discountSummary.discountPct)}
          hint="Total discount as a share of gross (pre-discount) sales this period"
          help="Total Discount divided by gross sales before any discount was applied (Price, not Sales Exc. Tax) - i.e. how much of the original sticker price was given away this period."
        />
      </div>

      <ProviderRevenueByTypeTable data={revenueByType} collections={collectionSummary} />

      <RedeemedPackagesTable data={redeemedPackages} />

      <DiscountsBreakdownTable data={discountBreakdown} />

      <DiscountDetailsTable data={discountDetails} />

      <InvoiceAgingSection rows={invoiceAging} bucketSummary={agingBucketSummary} asOfISO={asOfISO} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 print:grid-cols-1">
        <PatientTrendChart data={trend} />
        <RevenueTrendChart data={trend} />
      </div>

      <RetainedPatientsChart data={trend} />

      <MonthlyPatientTable data={trend} records={records} patients={patients} />

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

      <ReturnedPatientsTable data={returnedPatients} />
    </div>
  );
}
