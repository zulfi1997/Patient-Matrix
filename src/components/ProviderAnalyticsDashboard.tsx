import { useMemo } from 'react';
import type { CollectionRecord, ItemType, PackageBenefitRecord, SaleRecord } from '../types';
import type { ServiceDepartmentRecord } from '../lib/departments';
import {
  buildInvoiceToPatientMap,
  computeRangeConversion,
  resolveProvider,
  CONVERSION_CATEGORY_LABELS,
  FOLLOW_UP_REASON_LABELS,
  type ConversionCategory,
  type ProviderAssignmentOverride,
  type ProviderGroup,
  type RevenueAdjustment,
} from '../lib/conversionMetrics';
import {
  buildBenefitLookup,
  buildServiceDepartmentMap,
  computeDepartmentLineDetail,
  computeDepartmentProviderContribution,
} from '../lib/departmentAnalytics';
import {
  computeAgingBucketSummary,
  computeAtRiskPatients,
  computeFlaggedSummary,
  computeInvoiceAging,
  computeKpis,
  computeMonthlyTrend,
  computeRedeemedPackages,
  computeReturnedPatients,
  computeServiceStats,
  summarizePatients,
  type DateRange,
} from '../lib/metrics';
import { computeDiscountBreakdown, computeDiscountSummary } from '../lib/discounts';
import { computeProviderPatients, listProviders } from '../lib/providerHandover';
import { PRESET_LABELS, resolvePreset, type PresetKey } from '../lib/dateRanges';
import { formatCurrency, formatDate, formatNumber, formatPercent, toISODate } from '../lib/format';
import { money, pct, type WorkbookSheet } from '../lib/workbook';
import { contextSheet, conversionSheets, departmentDetailSheets } from '../lib/dashboardExports';
import {
  computeProviderRevenueByType,
  netAdjustmentForProvider,
  REVENUE_TYPE_LABELS,
  visibleRevenueTypeKeys,
  totalRevenueByType,
} from '../lib/providerRevenueByType';
import { buildInvoiceProviderShares, computeProviderCollections, salesDateSpan } from '../lib/collections';
import { ProviderRevenueByTypeTable } from './ProviderRevenueByTypeTable';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { KpiCard } from './KpiCard';
import { PeriodPresetSelect } from './PeriodPresetSelect';
import { PatientTrendChart } from './PatientTrendChart';
import { RevenueTrendChart } from './RevenueTrendChart';
import { TopServicesChart } from './TopServicesChart';
import { RedeemedPackagesTable } from './RedeemedPackagesTable';
import { DiscountsBreakdownTable } from './DiscountsBreakdownTable';
import { AtRiskPatientsTable } from './AtRiskPatientsTable';
import { ExportExcelButton } from './ExportExcelButton';

const SERVICE_TYPE_OPTIONS: (ItemType | 'All')[] = ['Service', 'Product', 'Package', 'All'];

export function ProviderAnalyticsDashboard({
  records,
  conversionRecords,
  packageBenefits,
  serviceDepartmentRecords,
  providerGroups,
  providerAssignmentOverrides,
  revenueAdjustments,
  collections,
  rawRecords,
}: {
  records: SaleRecord[];
  /**
   * Same records, but without the zero-revenue exclusion applied. Conversion is *defined* by
   * whether a visit produced revenue, so dropping zero-value lines would delete every unconverted
   * patient and lift the rate without anything having improved.
   */
  conversionRecords: SaleRecord[];
  packageBenefits: PackageBenefitRecord[];
  serviceDepartmentRecords: ServiceDepartmentRecord[];
  providerGroups: ProviderGroup[];
  providerAssignmentOverrides: ProviderAssignmentOverride[];
  revenueAdjustments: RevenueAdjustment[];
  collections: CollectionRecord[];
  /** Unfiltered stored rows - collection attribution must see gift/prepaid-card invoices, which the analysis filters drop. */
  rawRecords: SaleRecord[];
}) {
  const [preset, setPreset] = useLocalStorageState<PresetKey>('pm-provider-preset', 'last90');
  const [customRange, setCustomRange] = useLocalStorageState<DateRange>('pm-provider-custom-range', {
    start: toISODate(new Date(Date.now() - 89 * 86_400_000)),
    end: toISODate(new Date()),
  });
  const [inactivityDays, setInactivityDays] = useLocalStorageState('pm-provider-inactivity-days', 90);
  const [provider, setProvider] = useLocalStorageState('pm-provider-selected', '');
  // Matches the main Dashboard's default. Ranking services by "All" puts package *sales* in the
  // list, which are not services and whose value is delivered later as redemptions.
  const [serviceType, setServiceType] = useLocalStorageState<ItemType | 'All'>('pm-provider-service-type', 'Service');
  const [conversionCategory, setConversionCategory] = useLocalStorageState('pm-provider-conversion-category', 'all');

  const asOfISO = useMemo(() => {
    if (records.length === 0) return toISODate(new Date());
    return records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date);
  }, [records]);

  const range = useMemo(() => resolvePreset(preset, asOfISO, customRange), [preset, asOfISO, customRange]);
  const periodLabel = `${PRESET_LABELS[preset]} (${range.start} to ${range.end})`;

  const providers = useMemo(
    () => listProviders(records, providerGroups, providerAssignmentOverrides),
    [records, providerGroups, providerAssignmentOverrides],
  );
  const selected = provider || providers[0] || '';

  /**
   * Every figure below is the existing dashboard computation run over this provider's lines
   * rather than a provider-specific reimplementation, so a change to how revenue, retention or
   * discounts are defined reaches here automatically and cannot drift from the clinic-wide view.
   */
  const providerRecords = useMemo(
    () => records.filter((r) => resolveProvider(r.staff, r.date, providerGroups, providerAssignmentOverrides) === selected),
    [records, selected, providerGroups, providerAssignmentOverrides],
  );

  /**
   * Patients summarized from this provider's lines alone, so every patient figure reads
   * consistently "within this provider's book" - active, returning, retention and stopped-visiting
   * all scoped the same way. "New" therefore means new to this provider. The genuinely different
   * number, how many were also new to the clinic, is computed separately below rather than
   * conflated with it.
   */
  const providerPatientsMap = useMemo(() => summarizePatients(providerRecords), [providerRecords]);
  const clinicPatients = useMemo(() => summarizePatients(records), [records]);

  const kpis = useMemo(
    () => computeKpis(providerRecords, range, providerPatientsMap, inactivityDays, asOfISO),
    [providerRecords, range, providerPatientsMap, inactivityDays, asOfISO],
  );

  const newToClinic = useMemo(() => {
    const seen = new Set<string>();
    for (const r of providerRecords) {
      if (r.date < range.start || r.date > range.end) continue;
      const s = clinicPatients.get(r.patientId);
      if (s && s.firstVisit >= range.start && s.firstVisit <= range.end) seen.add(r.patientId);
    }
    return seen.size;
  }, [providerRecords, clinicPatients, range]);

  const trend = useMemo(
    () => computeMonthlyTrend(providerRecords, providerPatientsMap, 12, asOfISO),
    [providerRecords, providerPatientsMap, asOfISO],
  );
  const serviceStats = useMemo(() => computeServiceStats(providerRecords, range, serviceType), [providerRecords, range, serviceType]);
  const redeemedPackages = useMemo(() => computeRedeemedPackages(providerRecords, range), [providerRecords, range]);
  // Filtered after the fact, not before: an adjustment moving revenue *to* this provider comes
  // from someone else, and computing it here would otherwise leave that other provider's row
  // sitting on a single-provider tab.
  const revenueByType = useMemo(
    () => computeProviderRevenueByType(providerRecords, range, providerGroups, providerAssignmentOverrides, revenueAdjustments)
      .filter((r) => r.provider === selected),
    [providerRecords, range, providerGroups, providerAssignmentOverrides, revenueAdjustments, selected],
  );
  /**
   * Revenue Adjustments are a statement about who earned what, so every per-provider revenue figure
   * on this tab has to carry them or the tab contradicts itself. Departments and Top Services
   * deliberately do not: an adjustment names no service and no department, so there is nothing to
   * move there without inventing one.
   */
  const netAdjustment = useMemo(
    () => netAdjustmentForProvider(selected, range, revenueAdjustments, providerGroups, providerAssignmentOverrides),
    [selected, range, revenueAdjustments, providerGroups, providerAssignmentOverrides],
  );

  const periodRevenue = kpis.periodRevenue + netAdjustment;

  const adjustedTrend = useMemo(
    () => trend.map((t) => {
      const monthEnd = new Date(Number(t.month.slice(0, 4)), Number(t.month.slice(5, 7)), 0);
      const monthAdjustment = netAdjustmentForProvider(
        selected, { start: t.month, end: toISODate(monthEnd) }, revenueAdjustments, providerGroups, providerAssignmentOverrides,
      );
      return monthAdjustment === 0 ? t : { ...t, revenue: t.revenue + monthAdjustment };
    }),
    [trend, selected, revenueAdjustments, providerGroups, providerAssignmentOverrides],
  );

  // Shares come from every record, not this provider's: an invoice they share with a colleague has
  // to divide by both their contributions, which narrowing first would hide.
  const collectionSummary = useMemo(() => {
    if (collections.length === 0) return null;
    const shares = buildInvoiceProviderShares(rawRecords, providerGroups, providerAssignmentOverrides);
    const summary = computeProviderCollections(collections, shares, range, salesDateSpan(rawRecords));
    return { ...summary, providers: summary.providers.filter((p) => p.provider === selected) };
  }, [collections, rawRecords, range, providerGroups, providerAssignmentOverrides, selected]);

  const providerCollected = collectionSummary?.providers[0] ?? null;

  const discountSummary = useMemo(() => computeDiscountSummary(providerRecords, range), [providerRecords, range]);
  const discountBreakdown = useMemo(() => computeDiscountBreakdown(providerRecords, range), [providerRecords, range]);
  const flagged = useMemo(() => computeFlaggedSummary(providerRecords, range), [providerRecords, range]);
  const invoiceAging = useMemo(() => computeInvoiceAging(providerRecords, asOfISO), [providerRecords, asOfISO]);
  const agingBuckets = useMemo(() => computeAgingBucketSummary(invoiceAging), [invoiceAging]);
  const atRisk = useMemo(
    () => computeAtRiskPatients(providerPatientsMap, asOfISO, inactivityDays),
    [providerPatientsMap, asOfISO, inactivityDays],
  );
  const returned = useMemo(
    () => computeReturnedPatients(providerRecords, providerPatientsMap, inactivityDays, asOfISO),
    [providerRecords, providerPatientsMap, inactivityDays, asOfISO],
  );

  // Conversion runs over ALL records, not the provider-filtered set: a patient is classified new or
  // repeat by their history across the clinic, and narrowing the input first would make everyone
  // look new. It also runs over conversionRecords rather than records - see the prop's note.
  const conversionSummary = useMemo(() => {
    const invoiceToPatient = buildInvoiceToPatientMap(conversionRecords);
    const benefitsByDate = new Map<string, PackageBenefitRecord[]>();
    for (const b of packageBenefits) {
      if (!benefitsByDate.has(b.snapshotDate)) benefitsByDate.set(b.snapshotDate, []);
      benefitsByDate.get(b.snapshotDate)!.push(b);
    }
    return computeRangeConversion(
      conversionRecords, summarizePatients(conversionRecords), range, invoiceToPatient, benefitsByDate,
      providerGroups, revenueAdjustments, providerAssignmentOverrides,
    );
  }, [conversionRecords, range, packageBenefits, providerGroups, revenueAdjustments, providerAssignmentOverrides]);

  const conversion = useMemo(
    () => conversionSummary.providers.find((p) => p.staff === selected) ?? null,
    [conversionSummary, selected],
  );

  const conversionRows = useMemo(
    () => conversionSummary.patientRows.filter((r) => r.staff === selected),
    [conversionSummary, selected],
  );

  const visibleConversionRows = useMemo(
    () => (conversionCategory === 'all' ? conversionRows : conversionRows.filter((r) => r.category === conversionCategory)),
    [conversionRows, conversionCategory],
  );

  const departmentMaps = useMemo(() => ({
    mapping: buildServiceDepartmentMap(serviceDepartmentRecords),
    lookup: buildBenefitLookup(packageBenefits, serviceDepartmentRecords),
  }), [serviceDepartmentRecords, packageBenefits]);

  const departmentRows = useMemo(
    () => computeDepartmentProviderContribution(records, range, departmentMaps.mapping, departmentMaps.lookup, providerGroups, providerAssignmentOverrides)
      .filter((r) => r.provider === selected)
      .sort((a, b) => b.revenue - a.revenue),
    [records, range, departmentMaps, providerGroups, providerAssignmentOverrides, selected],
  );

  /**
   * The lines behind those totals. Computed lazily rather than in a memo - it is only ever needed
   * when the export button is pressed, and it is one row per line item per department touched.
   */
  const departmentLines = () =>
    computeDepartmentLineDetail(records, range, departmentMaps.mapping, departmentMaps.lookup, providerGroups, providerAssignmentOverrides)
      .filter((r) => r.provider === selected);

  const departmentReadMe = (): [string, string | number][] => [
    ['Report', `Departments - ${selected}`],
    ['Period', periodLabel],
    ['Data as of', asOfISO],
    ['Scope', `Every line item ${selected} produced in the period, and the department each one landed in.`],
    ['Mapped Via', 'How the department was decided. "Service mapping" is your explicit mapping for that service. "Package benefits" means the package itself was not mapped, so it was attributed by the services it bundles. "No mapping found" is shown rather than dropped, so nothing goes missing quietly.'],
    ['Department Share', 'Below 100% only where a mixed package spans departments - revenue is split by each bundled service\'s value share rather than guessing one department. A line\'s share rows always add back to its Full Line Revenue.'],
    ['Transactions', 'One per constituent service, so a bundle counts the same as buying those services separately - not one per session.'],
    ['Package Redeemed', 'Sessions consumed from a previously-sold package. Reported beside revenue, never inside it, since that value was recognized when the package was sold.'],
    ['Provider', 'Canonical name after Provider Groups and date-scoped overrides, so an assisting nurse counts under whichever doctor she assisted that day.'],
    ['Currency', 'OMR. Amounts are numbers, not text, so they pivot and sum directly.'],
  ];

  // Repeat-visit behaviour for this provider over the same window, so "did they come back" sits
  // beside the revenue it explains.
  const retention = useMemo(
    () => computeProviderPatients(records, {
      provider: selected, fromDate: range.start, asOfISO,
      providerGroups, overrides: providerAssignmentOverrides,
    }),
    [records, selected, range, asOfISO, providerGroups, providerAssignmentOverrides],
  );

  const totalDue = invoiceAging.reduce((s, r) => s + r.dueAmount, 0);

  const buildSheets = (): WorkbookSheet[] => [
    contextSheet([
      ['Report', `Provider Analytics - ${selected}`],
      ['Period', periodLabel],
      ['Data as of', asOfISO],
      ['Scope', 'Every figure is the clinic-wide dashboard calculation run over this provider\'s lines, so definitions match the other tabs exactly.'],
      ['Provider', 'Canonical name after Provider Groups and date-scoped overrides, so an assisting nurse counts under the doctor she assisted that day.'],
      ['New Patients', 'New to this provider. The count also new to the clinic is reported separately, since they are different questions.'],
      ['Collected (Cash)', 'Money actually received in the period, by collection date rather than sale date, on invoices this provider sold. Package, gift-card and prepaid-card settlements are excluded - that cash arrived when the package or card was bought. Only present once a Collections export has been imported.'],
      ['Revenue Adjustments', 'Master Control corrections dated in this period are included in Revenue and the monthly trend. Departments and Top Services exclude them - an adjustment names no service or department, so there is nothing to move there without inventing one.'],
      ['Conversion', 'Computed across all clinic records then filtered to this provider - classifying new vs repeat from a narrowed set would make everyone look new. Zero-revenue visits are always included here, whatever the header toggle says, because an unconverted visit is defined by having produced no revenue.'],
      ['Top Services', `Category filter: ${serviceType}. Package sales are excluded under "Service", since the package is not itself a service and its value arrives later as redemptions.`],
      ['Invoice Ageing', 'Spans all sales data, not the selected period - a balance does not stop being owed because its sale date falls outside the window.'],
      ['Currency', 'OMR. Amounts are numbers, not text, so they pivot and sum directly.'],
    ]),
    {
      name: 'Summary',
      rows: [
        { Metric: 'Revenue', Value: money(periodRevenue) },
        { Metric: 'Revenue Adjustment', Value: money(netAdjustment) },
        { Metric: 'Collected (Cash)', Value: providerCollected ? money(providerCollected.cashCollected) : '' },
        { Metric: 'Settled By Package/Card', Value: providerCollected ? money(providerCollected.redemptionSettled) : '' },
        { Metric: 'Redeemed Revenue', Value: money(kpis.periodRedeemedRevenue) },
        { Metric: 'Line Items', Value: kpis.periodTransactions },
        { Metric: 'Active Patients', Value: kpis.activePatients },
        { Metric: 'New To This Provider', Value: kpis.newPatients },
        { Metric: 'New To The Clinic', Value: newToClinic },
        { Metric: 'Returning Patients', Value: kpis.returningPatients },
        { Metric: 'Retention Rate (%)', Value: pct(kpis.retentionRate) },
        { Metric: 'Turnover Rate (%)', Value: pct(kpis.turnoverRate) },
        { Metric: `Stopped Visiting (${inactivityDays}+ days)`, Value: kpis.stoppedVisiting },
        { Metric: 'Came Back At Least Once (%)', Value: pct(retention.repeatRate) },
        { Metric: 'Seen Once Then Nothing', Value: retention.onceThenQuiet.patients },
        { Metric: 'Seen Once Then A Colleague', Value: retention.onceThenElsewhere.patients },
        { Metric: 'Conversion Rate (%)', Value: conversion ? pct(conversion.conversionRate) : '' },
        { Metric: 'Total Discount', Value: money(discountSummary.totalDiscount) },
        { Metric: 'Discount (%)', Value: pct(discountSummary.discountPct) },
        { Metric: 'YB111 Flagged Lines', Value: flagged.count },
        { Metric: 'YB111 Flagged Value', Value: money(flagged.amount) },
        { Metric: 'Outstanding Due', Value: money(totalDue) },
        { Metric: 'Outstanding Invoices', Value: invoiceAging.length },
      ],
    },
    {
      name: 'Monthly Trend',
      rows: adjustedTrend.map((t) => ({
        Month: t.month.slice(0, 7), 'Active Patients': t.activePatients, 'New Patients': t.newPatients,
        'Returning Patients': t.returningPatients, 'Retention Rate (%)': pct(t.retentionRate),
        Revenue: money(t.revenue), 'Line Items': t.transactions,
      })),
    },
    {
      name: 'Services',
      rows: serviceStats.map((s) => ({
        Service: s.serviceName, 'Item Type': s.itemType, 'Times Sold': s.count, Qty: s.qty,
        Revenue: money(s.revenue), 'Package Redeemed': money(s.redeemedRevenue), 'Delivered Value': money(s.deliveredValue),
      })),
    },
    { name: 'Departments', rows: departmentRows.map((d) => ({ Department: d.department, Revenue: money(d.revenue), Transactions: d.transactions })) },
    ...departmentDetailSheets(departmentLines()),
    {
      // One row per bucket rather than one wide row, since a single-provider workbook reads better
      // down the page than across it.
      name: 'Revenue By Type',
      rows: (() => {
        const total = totalRevenueByType(revenueByType);
        return [
          ...visibleRevenueTypeKeys(total).map((k) => ({
            Type: REVENUE_TYPE_LABELS[k], Revenue: money(total.amounts[k]), 'Line Items': total.lines[k],
          })),
          { Type: 'Net Revenue', Revenue: money(total.netRevenue), 'Line Items': '' },
          { Type: 'Package Redeemed (not revenue)', Revenue: money(total.redeemed), 'Line Items': '' },
          { Type: 'Delivered Value', Revenue: money(total.deliveredValue), 'Line Items': '' },
        ];
      })(),
    },
    ...conversionSheets({
      providers: conversion ? [conversion] : [],
      patientRows: conversionRows,
      categoryLabels: CONVERSION_CATEGORY_LABELS,
      followUpLabels: FOLLOW_UP_REASON_LABELS,
    }),
    { name: 'Redeemed Packages', rows: redeemedPackages.map((r) => ({ Package: r.packageName, 'Sessions Consumed': r.count, 'Value Delivered': money(r.redeemedAmount) })) },
    { name: 'Discounts', rows: discountBreakdown.map((d) => ({ Discount: d.label, Lines: d.count, Amount: money(d.amount) })) },
    {
      name: 'Patient Retention',
      rows: retention.patients.map((p) => ({
        'Patient ID': p.patientId, Patient: p.patientName, Outcome: p.outcome, Origin: p.origin,
        Visits: p.visitsWithProvider, 'First Seen': p.firstVisitWithProvider, 'Last Seen': p.lastVisitWithProvider,
        Value: money(p.valueWithProvider), 'Seen After By': p.seenAfterElsewhere.join('; '), 'Days Away': p.daysSinceLastVisit,
      })),
    },
    {
      name: 'Stopped Visiting',
      rows: atRisk.map((a) => ({
        'Patient ID': a.patientId, Patient: a.patientName, 'Last Visit': a.lastVisit,
        'Days Since': a.daysSinceLastVisit, 'Visits': a.lifetimeVisits, 'Revenue': money(a.lifetimeRevenue),
      })),
    },
    {
      name: 'Outstanding Invoices',
      rows: invoiceAging.map((r) => ({
        'Invoice No': r.invoiceNo, Patient: r.patientName, 'Sale Date': r.date, 'Age (days)': r.ageDays,
        Bucket: r.agingBucket, Status: r.invoiceStatus, Due: money(r.dueAmount), Comments: r.notes.join('; '),
      })),
    },
  ];

  if (providers.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">No providers found in the imported sales data.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 print:hidden">Provider Analytics</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Everything the other dashboards show, narrowed to one provider. Each figure is that dashboard's own
            calculation run over this provider's lines, so the definitions match rather than approximate them.
            Assisting staff fold into whichever doctor they assisted on the day, per your Provider Groups.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            Provider
            <select
              value={selected}
              onChange={(e) => setProvider(e.target.value)}
              className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <PeriodPresetSelect preset={preset} onPresetChange={setPreset} customRange={customRange} onCustomRangeChange={setCustomRange} />
          <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            Inactive after
            <select
              value={inactivityDays}
              onChange={(e) => setInactivityDays(Number(e.target.value))}
              className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {[30, 60, 90, 120, 180].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
          <ExportExcelButton fileName={`provider-${selected.replace(/\W+/g, '-')}-${range.start}-to-${range.end}.xlsx`} buildSheets={buildSheets} />
        </div>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Showing <strong>{selected}</strong> for {periodLabel}, data as of {asOfISO}. Patient figures are scoped to this
        provider's own book, so "new" means new to them - the count also new to the clinic is shown separately, since
        those answer different questions.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard
          label="Revenue"
          value={formatCurrency(periodRevenue)}
          hint={netAdjustment !== 0
            ? `${formatNumber(kpis.periodTransactions)} line items · includes ${netAdjustment > 0 ? '+' : ''}${formatCurrency(netAdjustment)} adjustment`
            : `${formatNumber(kpis.periodTransactions)} line items`}
          help="New cash from this provider's lines, after any Master Control Revenue Adjustments dated in this period. Excludes package sessions consumed, which are reported beside it."
        />
        <KpiCard label="Redeemed Revenue" value={formatCurrency(kpis.periodRedeemedRevenue)} hint="value delivered via package redemption" help="Value of previously-sold package sessions this provider delivered. Already recognized when the package was sold, so it is not counted as new revenue." />
        <KpiCard label="Active Patients" value={formatNumber(kpis.activePatients)} help="Distinct patients this provider saw in the period." />
        <KpiCard label="New To This Provider" value={formatNumber(kpis.newPatients)} hint={`${formatNumber(newToClinic)} of them also new to the clinic`} tone="good" help="First time seeing this provider. The hint counts those whose first-ever clinic visit was also in this period - a genuinely new patient rather than one who transferred internally." />
        <KpiCard label="Returning Patients" value={formatNumber(kpis.returningPatients)} help="Patients who had already seen this provider before the period began." />
        <KpiCard label="Retention Rate" value={formatPercent(kpis.retentionRate)} hint={`${formatNumber(kpis.retainedPatients)} of ${formatNumber(kpis.prevActivePatients)} prior-period patients returned`} tone={kpis.retentionRate != null && kpis.retentionRate < 50 ? 'bad' : 'good'} help="Of this provider's patients in the prior equivalent period, the share who saw them again in this one." />
        <KpiCard label="Came Back At Least Once" value={formatPercent(retention.repeatRate)} hint={`${formatNumber(retention.onceThenQuiet.patients)} seen once then nothing`} tone={retention.repeatRate != null && retention.repeatRate < 40 ? 'bad' : 'good'} help="Share of patients seen in this window who returned for a second visit. A single visit followed by silence is counted separately from one who moved to a colleague." />
        <KpiCard label="Stopped Visiting" value={formatNumber(kpis.stoppedVisiting)} hint={`no visit with this provider for ${inactivityDays}+ days`} tone="bad" help="Patients of this provider with no visit to them in the threshold, as of today. Scoped to this provider, so it counts people they have lost rather than the clinic's total." />
        {conversion && (
          <KpiCard label="Conversion Rate" value={formatPercent(conversion.conversionRate)} hint={`${formatNumber(conversion.total)} patients classified`} tone={conversion.conversionRate != null && conversion.conversionRate < 50 ? 'bad' : 'good'} help="From the Provider Conversion tab, using its own logic: converted divided by those who were a conversion opportunity. Follow-up and direct-service visits are excluded from the denominator." />
        )}
        <KpiCard label="Total Discount" value={formatCurrency(discountSummary.totalDiscount)} hint={formatPercent(discountSummary.discountPct) + ' of gross sales'} tone="bad" help="Every discount on this provider's lines except package redemption, which is not a discount." />
        <KpiCard label="YB111 Flagged" value={formatNumber(flagged.count)} hint={formatCurrency(flagged.amount)} help="Line items on this provider's invoices whose notes contain YB111." />
        {providerCollected && (
          <KpiCard
            label="Collected (Cash)"
            value={formatCurrency(providerCollected.cashCollected)}
            hint={`${formatNumber(providerCollected.invoices)} invoice(s) · ${formatCurrency(providerCollected.redemptionSettled)} by package/card`}
            help="Money actually received in this period, by collection date rather than sale date, on invoices this provider sold. Package, gift-card and prepaid-card settlements are excluded - that cash arrived when the package or card was bought. Where an invoice carries more than one provider's lines, the payment is split by each one's share of it."
          />
        )}
        <KpiCard label="Outstanding Due" value={formatCurrency(totalDue)} hint={`${formatNumber(invoiceAging.length)} invoices, all history`} tone={totalDue > 0 ? 'bad' : 'neutral'} help="Unpaid balances on invoices containing this provider's lines, across all sales data rather than the selected period." />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 print:grid-cols-1">
        <PatientTrendChart data={trend} />
        <RevenueTrendChart data={adjustedTrend} />
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Conversion</h3>
          <select
            value={conversionCategory}
            onChange={(e) => setConversionCategory(e.target.value)}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-xs print:hidden dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="all">All Categories</option>
            {(Object.keys(CONVERSION_CATEGORY_LABELS) as ConversionCategory[]).map((key) => (
              <option key={key} value={key}>{CONVERSION_CATEGORY_LABELS[key]}</option>
            ))}
          </select>
        </div>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          The Provider Conversion tab's own classification, narrowed to {selected}. Each patient is classified once per
          day on that day's terms: a visit that produced revenue converted, one that didn't did not. Follow-up / direct
          service visits - a package redemption, a remaining package balance, or a "YB111" flag - are left out of the
          rate entirely, since there was nothing to convert. Zero-revenue visits are always included here regardless of
          the header toggle, because excluding them would delete the unconverted patients.
        </p>
        {!conversion ? (
          <p className="py-6 text-center text-sm text-zinc-500">No visits classified for this provider in the period.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {([
                ['New Unconverted', conversion.newUnconverted, 'bad'],
                ['New Converted', conversion.newConverted, 'good'],
                ['Repeat Unconverted', conversion.repeatUnconverted, 'bad'],
                ['Repeat Converted', conversion.repeatConverted, 'good'],
                ['Follow-up / Direct', conversion.followUp, 'neutral'],
                ['Total Patients', conversion.total, 'neutral'],
              ] as [string, number, string][]).map(([label, value, tone]) => (
                <div key={label} className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-700">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
                  <div className={`text-sm font-semibold ${
                    tone === 'bad' ? 'text-rose-600 dark:text-rose-400'
                      : tone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-zinc-900 dark:text-zinc-100'
                  }`}>
                    {formatNumber(value)}
                  </div>
                </div>
              ))}
              <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-700">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">Conversion Rate</div>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{formatPercent(conversion.conversionRate)}</div>
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Follow-ups by reason:{' '}
              {(Object.keys(FOLLOW_UP_REASON_LABELS) as (keyof typeof FOLLOW_UP_REASON_LABELS)[])
                .map((r) => `${FOLLOW_UP_REASON_LABELS[r]}: ${formatNumber(conversion.followUpByReason[r])}`)
                .join(' · ')}
            </p>
            <div className="mt-3 max-h-96 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  <tr>
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">Patient</th>
                    <th className="py-2 pr-2">Category</th>
                    <th className="py-2 pr-2">Reason</th>
                    <th className="py-2 pr-2 text-right">Revenue</th>
                    <th className="py-2 pr-2">Services</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleConversionRows.length === 0 ? (
                    <tr><td colSpan={6} className="py-6 text-center text-sm text-zinc-500">No patients match this filter.</td></tr>
                  ) : (
                    visibleConversionRows.map((r) => (
                      <tr key={`${r.date}-${r.patientId}`} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{formatDate(r.date)}</td>
                        <td className="py-1.5 pr-2">{r.patientName}</td>
                        <td className="py-1.5 pr-2">{CONVERSION_CATEGORY_LABELS[r.category]}</td>
                        <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">
                          {r.followUpReason ? FOLLOW_UP_REASON_LABELS[r.followUpReason] : '—'}
                        </td>
                        <td className="py-1.5 pr-2 text-right">{formatCurrency(r.revenue)}</td>
                        <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{r.services.join(', ')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

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
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Applies to Top Selling Services. "Service" is the default because a package sale is not a service - its value
          reaches the chart later, as the sessions it bundles are redeemed.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 print:grid-cols-1">
        <TopServicesChart data={serviceStats} />
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Departments</h3>
            <ExportExcelButton
              label="Department Detail"
              fileName={`departments-${selected.replace(/\W+/g, '-')}-${range.start}-to-${range.end}.xlsx`}
              disabled={departmentRows.length === 0}
              buildSheets={() => [contextSheet(departmentReadMe()), ...departmentDetailSheets(departmentLines())]}
            />
          </div>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Where this provider's revenue sits. A mixed package splits across departments by the value of the services
            it bundles, and counts one transaction per constituent service. The export breaks these totals down to the
            patient, the service and the individual line behind each one.
          </p>
          {departmentRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">No department-mapped revenue in this period.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-2">Department</th>
                  <th className="py-2 pr-2 text-right">Revenue</th>
                  <th className="py-2 pr-2 text-right">Transactions</th>
                </tr>
              </thead>
              <tbody>
                {departmentRows.map((d) => (
                  <tr key={d.department} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-2">{d.department}</td>
                    <td className="py-1.5 pr-2 text-right font-medium">{formatCurrency(d.revenue)}</td>
                    <td className="py-1.5 pr-2 text-right">{formatNumber(d.transactions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <ProviderRevenueByTypeTable data={revenueByType} collections={collectionSummary} />

      <RedeemedPackagesTable data={redeemedPackages} />
      <DiscountsBreakdownTable data={discountBreakdown} />

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Patients Who Returned After Going Quiet</h3>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Patients who went {inactivityDays}+ days without seeing this provider, then came back.
        </p>
        {returned.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">Nobody has returned after a gap this long.</p>
        ) : (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-2">Patient</th>
                  <th className="py-2 pr-2 text-right">Went Quiet</th>
                  <th className="py-2 pr-2 text-right">Returned</th>
                  <th className="py-2 pr-2 text-right">Since Return</th>
                  <th className="py-2 pr-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {returned.slice(0, 50).map((r) => (
                  <tr key={r.patientId} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-2">{r.patientName}</td>
                    <td className="py-1.5 pr-2 text-right">{formatDate(r.wentQuietOn)}</td>
                    <td className="py-1.5 pr-2 text-right">{formatDate(r.returnedOn)}</td>
                    <td className="py-1.5 pr-2 text-right">{formatCurrency(r.revenueSinceReturn)}</td>
                    <td className={`py-1.5 pr-2 ${r.currentlyActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {r.currentlyActive ? 'Still active' : 'Went quiet again'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AtRiskPatientsTable data={atRisk} />

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Outstanding Invoices</h3>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Unpaid balances on invoices containing this provider's lines, across all sales data rather than the period above.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {agingBuckets.map((b) => (
            <div key={b.bucket} className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-700">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{b.bucket} days</div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{formatCurrency(b.amount)}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{formatNumber(b.count)} invoices</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
