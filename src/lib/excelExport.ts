import type { SaleRecord } from '../types';
import type { DiscountBreakdownStat, DiscountDetailRow, DiscountSummary } from './discounts';
import { classifyDiscount, DISCOUNT_CATEGORY_LABELS } from './discounts';
import type {
  AgingBucketStat,
  AtRiskPatient,
  DateRange,
  InvoiceAgingRow,
  KpiResult,
  MonthlyTrendPoint,
  PatientVisitSummary,
  RedeemedPackageStat,
  ReturnedPatient,
  ServiceStat,
} from './metrics';
import { isInRange } from './metrics';
import { resolveProvider, type ProviderAssignmentOverride, type ProviderGroup } from './conversionMetrics';
import { hasFlaggedNote } from './filters';
import {
  hasUntypedAdjustment,
  REVENUE_TYPE_LABELS,
  totalRevenueByType,
  visibleRevenueTypeKeys,
  type ProviderRevenueByType,
} from './providerRevenueByType';
import { COLLECTION_METHOD_LABELS, isCashCollection, methodOf } from './collectionsParser';
import {
  needsInvestigation,
  UNMATCHED_REASON_LABELS,
  type CollectionSummary,
  type InvoiceAttributionRow,
} from './collections';
import { downloadWorkbook, money, type WorkbookSheet } from './workbook';

export interface WorkbookParams {
  periodLabel: string;
  range: DateRange;
  asOfISO: string;
  inactivityDays: number;
  serviceType: string;
  kpis: KpiResult;
  discountSummary: DiscountSummary;
  discountBreakdown: DiscountBreakdownStat[];
  discountDetails: DiscountDetailRow[];
  trend: MonthlyTrendPoint[];
  services: ServiceStat[];
  redeemedPackages: RedeemedPackageStat[];
  invoiceAging: InvoiceAgingRow[];
  agingBucketSummary: AgingBucketStat[];
  atRiskPatients: AtRiskPatient[];
  returnedPatients: ReturnedPatient[];
  revenueByType: ProviderRevenueByType[];
  /** Null until a Collections export has been imported. */
  collectionSummary: CollectionSummary | null;
  /** One row per payment per provider it was attributed to - the trace behind every split. */
  collectionAttribution: InvoiceAttributionRow[];
  /** Records already filtered the same way the dashboard filters them. */
  records: SaleRecord[];
  patients: Map<string, PatientVisitSummary>;
  providerGroups: ProviderGroup[];
  providerAssignmentOverrides: ProviderAssignmentOverride[];
}


/**
 * Notes carried into the workbook. Every figure here has a basis that differs from at least one
 * other figure in the app, and those distinctions are exactly what gets lost once numbers leave
 * the dashboard and land in someone's slide.
 */
function readMeRows(p: WorkbookParams): Record<string, string>[] {
  return [
    { Item: 'Period', Detail: `${p.periodLabel} (${p.range.start} to ${p.range.end})` },
    { Item: 'Data as of', Detail: p.asOfISO },
    { Item: 'Inactivity threshold', Detail: `${p.inactivityDays} days` },
    { Item: 'Service category filter', Detail: p.serviceType },
    { Item: 'Currency', Detail: 'OMR. All amounts are numbers, not text, so they pivot and sum directly.' },
    {
      Item: 'Revenue',
      Detail: 'New cash. Excludes the value of package sessions consumed, because that was already recognized when the package was sold.',
    },
    {
      Item: 'Delivered Value',
      Detail: 'Revenue plus package sessions consumed - Sales (Exc. Tax). The right basis for how much work a service or provider actually did.',
    },
    {
      Item: 'Gift and prepaid cards',
      Detail: 'Card purchases are excluded everywhere. A card is a means of payment; the invoice it later settles is the sale, and that invoice counts in full.',
    },
    {
      Item: 'Provider',
      Detail: 'Canonical name after Provider Groups and date-scoped overrides, so an assisting nurse counts under whichever doctor she assisted that day.',
    },
    {
      Item: 'Patient Type',
      Detail: 'New if this patient\'s first-ever visit falls in the selected period, otherwise Returning.',
    },
    {
      Item: 'Invoice Ageing',
      Detail: 'Spans all sales data, not the selected period - a balance does not stop being owed because its sale date falls outside the window.',
    },
    {
      Item: 'Collections',
      Detail: 'Money actually received, by collection date - often not the month the sale was recognized in, so this will not tie to Revenue and is not meant to. Package, gift-card and prepaid-card settlements are reported separately and excluded from the cash figure: that money arrived when the package or card was bought. Attribution runs through the invoice number against the sales data, since the export\'s "Collected By" is the cashier, not the seller.',
    },
    {
      Item: 'Collection, Refund, Net Collection',
      Detail: 'Money in, money out, and the two together. Kept as three figures so gross takings stay readable instead of a refund quietly eating into them. Refund is negative, so Collection + Refund = Net Collection. Package, gift-card and prepaid-card settlements are in none of the three - that cash arrived when the package or card was bought.',
    },
    {
      Item: 'Internal Transfers',
      Detail: 'Payment type "Custom - Refund - Internal" moves money between two of the clinic\'s own invoices - booked negative on the one losing it and positive on the one gaining it, same patient, same day. It is neither a collection nor a refund, so both legs are excluded from all three columns; Zenoti\'s own Collections summary reports this line as 0.000 for the same reason. Shown here once per pair so it is visible rather than missing.',
    },
    {
      Item: 'Card Refunds',
      Detail: 'A gift or prepaid card handed back - a subset of Refund, broken out because the card was paid for in an earlier period and so says nothing about this period\'s trading. Reported in its own column and kept out of Collected (Cash): the card was paid for in an earlier period, so netting its return against this period\'s takings would understate what was actually collected here. Identified from the sales lines behind the invoice - the Collections export shows a card refund as an ordinary negative payment, indistinguishable from a refunded service.',
    },
    {
      Item: 'Revenue Adjustments',
      Detail: 'Master Control corrections are applied per provider. One that names an item type moves that column; one that does not sits in an Adjustment column rather than being attributed to a type nobody stated. The All Providers row is unaffected either way, since an adjustment only moves revenue between two providers.',
    },
    {
      Item: 'Refunds',
      Detail: 'The sales export has no refund item type. A refund is the original line reversed - same Item Type, negative quantity and amount - so the Revenue By Type sheet splits sales from refunds by the sign of the line, and refunds stay negative so the columns add up.',
    },
  ];
}

/**
 * One row per provider, revenue split by what was sold and whether it was a sale or a reversal.
 * Sale and refund stay in separate columns rather than netted, since a provider who sold little
 * and one who sold plenty and had it handed back are the same number once they are netted.
 */
function revenueByTypeRows(p: WorkbookParams): Record<string, string | number>[] {
  const total = totalRevenueByType(p.revenueByType);
  const keys = visibleRevenueTypeKeys(total);
  const showAdjustment = hasUntypedAdjustment(p.revenueByType);
  const row = (r: ProviderRevenueByType) => ({
    Provider: r.provider,
    ...Object.fromEntries(keys.flatMap((k) => [
      [REVENUE_TYPE_LABELS[k], money(r.amounts[k])],
      [`${REVENUE_TYPE_LABELS[k]} Lines`, r.lines[k]],
    ])),
    ...(showAdjustment ? { Adjustment: money(r.adjustment) } : {}),
    'Net Revenue': money(r.netRevenue),
    'Package Redeemed': money(r.redeemed),
    'Delivered Value': money(r.deliveredValue),
  });
  return [...p.revenueByType.map(row), row(total)];
}

/**
 * Cash received per provider. Kept apart from the revenue sheets because the two answer different
 * questions - revenue is what was sold in the period, collection is what was paid for in it, and
 * an invoice raised in June settled in July belongs to both, in different months.
 */
function collectionRows(c: CollectionSummary): Record<string, string | number>[] {
  const row = (name: string, s: (typeof c.providers)[number] | null, collected: number, refunded: number, redemption: number) => ({
    Provider: name,
    Collection: money(collected),
    Refund: money(refunded),
    'Net Collection': money(collected + refunded),
    'Of Refund, Gift/Prepaid Card Handed Back': money(s?.cardRefunds ?? 0),
    ...Object.fromEntries(
      (Object.keys(COLLECTION_METHOD_LABELS) as (keyof typeof COLLECTION_METHOD_LABELS)[])
        .map((m) => [COLLECTION_METHOD_LABELS[m], money(s?.byMethod[m] ?? 0)]),
    ),
    'Settled By Package/Card': money(redemption),
    'Internal Transfers (neither in nor out)': money(s?.internalTransferred ?? 0),
    Invoices: s?.invoices ?? '',
    Payments: s?.payments ?? '',
  });
  return [
    ...c.providers.map((s) => row(s.provider, s, s.collected, s.refunded, s.redemptionSettled)),
    row('Unattributed (invoice not in sales data)', null, c.unattributedCollected, c.unattributedRefunded, c.unattributedRedemption),
    row('All Collections', null, c.totalCollected, c.totalRefunded, c.totalRedemption),
  ];
}

/**
 * The individual payments no provider could be resolved for, so the figure can be traced instead
 * of guessed at. The invoice date is the thing to check: a payment settling an invoice raised
 * before the earliest sales file imported has nothing to match against, and the fix is a wider
 * sales import rather than anything about the payment itself.
 */
/** The trace behind each provider's collected figure: which payment, which share, and why. */
function attributionRows(rows: InvoiceAttributionRow[]): Record<string, string | number>[] {
  return rows.map((r) => ({
    'Collection Date': r.date,
    Month: r.date.slice(0, 7),
    'Invoice No': r.invoiceNo,
    Patient: r.patientName,
    'Payment Type': r.paymentType,
    Method: COLLECTION_METHOD_LABELS[r.method],
    'Counts As': isCashCollection(r.method) ? 'Cash' : 'Package/card settlement',
    'Payment Amount': money(r.amount),
    Provider: r.provider,
    'Providers On Invoice': r.providersOnInvoice,
    'Share (%)': Math.round(r.share * 1000) / 10,
    'Attributed To Provider': money(r.attributed),
    Split: r.providersOnInvoice > 1 ? 'Yes - shared invoice' : 'No - sole provider',
  }));
}

function unattributedRows(c: CollectionSummary): Record<string, string | number>[] {
  return c.unattributed
    .slice()
    .sort((a, b) => a.payment.date.localeCompare(b.payment.date) || a.payment.invoiceNo.localeCompare(b.payment.invoiceNo))
    .map(({ payment: r, reason }) => ({
      'Collection Date': r.date,
      Month: r.date.slice(0, 7),
      'Invoice No': r.invoiceNo,
      'Why Unmatched': UNMATCHED_REASON_LABELS[reason],
      'Needs Action': needsInvestigation(reason) ? 'Yes' : 'No - widen the sales import',
      'Patient ID': r.patientId,
      Patient: r.patientName,
      'Payment Type': r.paymentType,
      Method: COLLECTION_METHOD_LABELS[methodOf(r)],
      'Counts As': isCashCollection(methodOf(r)) ? 'Cash' : 'Package/card settlement',
      Amount: money(r.amount),
      'Tax Collected': money(r.taxCollected),
      'Invoice Status': r.invoiceStatus,
      'Collected By (cashier)': r.collectedBy ?? '',
      Comments: r.comments ?? '',
      'Sales Data Spans': c.salesSpan ? `${c.salesSpan.start} to ${c.salesSpan.end}` : 'none imported',
    }));
}

function summaryRows(p: WorkbookParams): Record<string, string | number>[] {
  const k = p.kpis;
  const rows: [string, string | number][] = [
    ['Revenue', money(k.periodRevenue)],
    ['Redeemed Revenue', money(k.periodRedeemedRevenue)],
    ['Line Items', k.periodTransactions],
    ['Active Patients', k.activePatients],
    ['New Patients', k.newPatients],
    ['Returning Patients', k.returningPatients],
    ['Prior-Period Active Patients', k.prevActivePatients],
    ['Retained Patients', k.retainedPatients],
    ['Retention Rate (%)', k.retentionRate != null ? Math.round(k.retentionRate * 10) / 10 : ''],
    ['Turnover Rate (%)', k.turnoverRate != null ? Math.round(k.turnoverRate * 10) / 10 : ''],
    [`Stopped Visiting (${p.inactivityDays}+ days)`, k.stoppedVisiting],
    ['Total Discount', money(p.discountSummary.totalDiscount)],
    ['Discount (%)', p.discountSummary.discountPct != null ? Math.round(p.discountSummary.discountPct * 10) / 10 : ''],
    ['Gross Sales (pre-discount)', money(p.discountSummary.grossSales)],
    ['Total Outstanding', money(p.invoiceAging.reduce((s, r) => s + r.dueAmount, 0))],
    ['Outstanding Invoices', p.invoiceAging.length],
    ...(p.collectionSummary
      ? ([
          ['Collection', money(p.collectionSummary.totalCollected)],
          ['Refund', money(p.collectionSummary.totalRefunded)],
          ['Net Collection', money(p.collectionSummary.totalNetCollected)],
          ['Of Refund, Gift/Prepaid Card Handed Back', money(p.collectionSummary.totalCardRefunds)],
          ['Settled By Package/Card', money(p.collectionSummary.totalRedemption)],
          ['Internal Transfers (neither in nor out)', money(p.collectionSummary.totalInternalTransferred)],
          ['Collections Not Matched To An Invoice', money(p.collectionSummary.unattributedCollected + p.collectionSummary.unattributedRefunded)],
        ] as [string, string | number][])
      : []),
  ];
  return rows.map(([Metric, Value]) => ({ Metric, Value }));
}

/**
 * One row per sale line, with the derived columns a pivot needs - month, resolved provider,
 * patient type, and the cash/package split - so a chart can be built without re-deriving any of
 * it in Excel. This is the sheet a presentation actually gets built from; the others are
 * conveniences already aggregated.
 */
function transactionRows(p: WorkbookParams): Record<string, string | number>[] {
  return p.records
    .filter((r) => isInRange(r.date, p.range))
    .map((r) => {
      const summary = p.patients.get(r.patientId);
      const { category } = classifyDiscount(r.discountName);
      return {
        Date: r.date,
        Month: r.date.slice(0, 7),
        Year: Number(r.date.slice(0, 4)),
        'Invoice No': r.invoiceNo,
        'Invoice Status': r.invoiceStatus,
        'Patient ID': r.patientId,
        Patient: r.patientName,
        'Patient Type': summary && isInRange(summary.firstVisit, p.range) ? 'New' : 'Returning',
        'First Ever Visit': summary?.firstVisit ?? '',
        Provider: resolveProvider(r.staff, r.date, p.providerGroups, p.providerAssignmentOverrides),
        'Raw Staff': r.staff ?? '',
        Center: r.centerName,
        'Item Type': r.itemType,
        Service: r.serviceName,
        Subcategory: r.subcategory,
        Qty: r.qty,
        Revenue: money(r.amount),
        'Package Redeemed': money(r.redeemedAmount),
        'Delivered Value': money(r.amount + r.redeemedAmount),
        'Package Name': r.packageName ?? '',
        Discount: money(r.discountAmount),
        'Discount Type': r.discountAmount > 0 ? DISCOUNT_CATEGORY_LABELS[category] : '',
        'Discount Name': r.discountName ?? '',
        Due: money(r.dueAmount),
        'Payment Type': r.paymentType ?? '',
        YB111: hasFlaggedNote(r) ? 'Yes' : '',
        'Invoice Notes': r.invoiceNotes ?? '',
      };
    });
}

/**
 * Builds a multi-sheet workbook of everything the dashboard computed for the selected period.
 *
 * Exists because a generated deck can only ever approximate the one someone would have built
 * themselves. Handing over the figures - already reconciled, with the derived columns that make
 * them pivotable - is more useful than guessing at slides, and the Read Me sheet travels with
 * them so the bases that differ between figures survive the trip into a presentation.
 */
export async function exportDashboardWorkbook(p: WorkbookParams): Promise<void> {
  const sheets: WorkbookSheet[] = [
    { name: 'Read Me', rows: readMeRows(p) },
    { name: 'Summary', rows: summaryRows(p) },
    {
      name: 'Monthly Trend',
      rows: p.trend.map((t) => ({
        Month: t.month.slice(0, 7),
        'Active Patients': t.activePatients,
        'New Patients': t.newPatients,
        'Returning Patients': t.returningPatients,
        'Retained From Prior Month': t.retainedPatients,
        'Prior Month Active': t.prevMonthActivePatients,
        'Retention Rate (%)': t.retentionRate != null ? Math.round(t.retentionRate * 10) / 10 : '',
        Revenue: money(t.revenue),
        'New Patient Revenue': money(t.newPatientRevenue),
        'Returning Patient Revenue': money(t.returningPatientRevenue),
        'Line Items': t.transactions,
      })),
    },
    { name: 'Revenue By Type', rows: revenueByTypeRows(p) },
    ...(p.collectionSummary
      ? [
          { name: 'Collections', rows: collectionRows(p.collectionSummary) },
          { name: 'Collections By Invoice', rows: attributionRows(p.collectionAttribution) },
          ...(p.collectionSummary.unattributed.length > 0
            ? [{ name: 'Collections Unmatched', rows: unattributedRows(p.collectionSummary) }]
            : []),
        ]
      : []),
    {
      name: 'Services',
      rows: p.services.map((s) => ({
        Service: s.serviceName,
        'Item Type': s.itemType,
        Subcategory: s.subcategory,
        'Times Sold': s.count,
        Qty: s.qty,
        Revenue: money(s.revenue),
        'Package Redeemed': money(s.redeemedRevenue),
        'Delivered Value': money(s.deliveredValue),
      })),
    },
    {
      name: 'Redeemed Packages',
      rows: p.redeemedPackages.map((r) => ({ Package: r.packageName, 'Sessions Consumed': r.count, 'Value Delivered': money(r.redeemedAmount) })),
    },
    {
      name: 'Discounts',
      rows: p.discountBreakdown.map((d) => ({ Discount: d.label, Category: DISCOUNT_CATEGORY_LABELS[d.category], Lines: d.count, Amount: money(d.amount) })),
    },
    {
      name: 'Discount Details',
      rows: p.discountDetails.map((d) => ({
        Date: d.date, 'Invoice No': d.invoiceNo, Patient: d.patientName, Service: d.serviceName,
        'Discount Name': d.discountName ?? '', Category: DISCOUNT_CATEGORY_LABELS[d.category],
        'Price Before': money(d.price), Discount: money(d.discountAmount), 'Price After': money(d.netPrice),
      })),
    },
    {
      name: 'Invoice Ageing',
      rows: p.invoiceAging.map((r) => ({
        'Invoice No': r.invoiceNo, 'Patient ID': r.patientId, Patient: r.patientName, 'Sale Date': r.date,
        'Age (days)': r.ageDays, Bucket: r.agingBucket, Services: r.services.join('; '),
        Status: r.invoiceStatus, Due: money(r.dueAmount), Comments: r.notes.join('; '),
      })),
    },
    { name: 'Ageing Buckets', rows: p.agingBucketSummary.map((b) => ({ Bucket: `${b.bucket} days`, Invoices: b.count, Amount: money(b.amount) })) },
    {
      name: 'Stopped Visiting',
      rows: p.atRiskPatients.map((a) => ({
        'Patient ID': a.patientId, Patient: a.patientName, 'First Visit': a.firstVisit, 'Last Visit': a.lastVisit,
        'Days Since Last Visit': a.daysSinceLastVisit, 'Lifetime Visits': a.lifetimeVisits, 'Lifetime Revenue': money(a.lifetimeRevenue),
      })),
    },
    {
      name: 'Returned Patients',
      rows: p.returnedPatients.map((r) => ({
        'Patient ID': r.patientId, Patient: r.patientName, 'Went Quiet On': r.wentQuietOn, 'Gap (days)': r.gapDays,
        'Returned On': r.returnedOn, 'Days Since Return': r.daysSinceReturn, 'Visits Since Return': r.visitsSinceReturn,
        'Revenue Since Return': money(r.revenueSinceReturn), 'Still Active': r.currentlyActive ? 'Yes' : 'No',
      })),
    },
    { name: 'Transactions', rows: transactionRows(p) },
  ];

  await downloadWorkbook(`patient-matrix-${p.range.start}-to-${p.range.end}.xlsx`, sheets);
}
