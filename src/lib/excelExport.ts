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
  /** Records already filtered the same way the dashboard filters them. */
  records: SaleRecord[];
  patients: Map<string, PatientVisitSummary>;
  providerGroups: ProviderGroup[];
  providerAssignmentOverrides: ProviderAssignmentOverride[];
}

/** Rounded to fils. Written as a number, never a formatted string - a pivot cannot sum "OMR 1,234.000". */
const money = (n: number) => Math.round(n * 1000) / 1000;

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
  ];
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

/** Sizes columns from their content so the workbook opens readable rather than full of ####. */
function columnWidths(rows: Record<string, unknown>[]): { wch: number }[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]).map((key) => {
    const longest = rows.reduce((max, r) => Math.max(max, String(r[key] ?? '').length), key.length);
    return { wch: Math.min(46, Math.max(9, longest + 2)) };
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
  // Lazily loaded for the same reason excelParser.ts defers it: xlsx is large and only needed
  // when someone actually exports.
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const sheets: [string, Record<string, unknown>[]][] = [
    ['Read Me', readMeRows(p)],
    ['Summary', summaryRows(p)],
    [
      'Monthly Trend',
      p.trend.map((t) => ({
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
    ],
    [
      'Services',
      p.services.map((s) => ({
        Service: s.serviceName,
        'Item Type': s.itemType,
        Subcategory: s.subcategory,
        'Times Sold': s.count,
        Qty: s.qty,
        Revenue: money(s.revenue),
        'Package Redeemed': money(s.redeemedRevenue),
        'Delivered Value': money(s.deliveredValue),
      })),
    ],
    [
      'Redeemed Packages',
      p.redeemedPackages.map((r) => ({ Package: r.packageName, 'Sessions Consumed': r.count, 'Value Delivered': money(r.redeemedAmount) })),
    ],
    [
      'Discounts',
      p.discountBreakdown.map((d) => ({ Discount: d.label, Category: DISCOUNT_CATEGORY_LABELS[d.category], Lines: d.count, Amount: money(d.amount) })),
    ],
    [
      'Discount Details',
      p.discountDetails.map((d) => ({
        Date: d.date, 'Invoice No': d.invoiceNo, Patient: d.patientName, Service: d.serviceName,
        'Discount Name': d.discountName ?? '', Category: DISCOUNT_CATEGORY_LABELS[d.category],
        'Price Before': money(d.price), Discount: money(d.discountAmount), 'Price After': money(d.netPrice),
      })),
    ],
    [
      'Invoice Ageing',
      p.invoiceAging.map((r) => ({
        'Invoice No': r.invoiceNo, 'Patient ID': r.patientId, Patient: r.patientName, 'Sale Date': r.date,
        'Age (days)': r.ageDays, Bucket: r.agingBucket, Services: r.services.join('; '),
        Status: r.invoiceStatus, Due: money(r.dueAmount), Comments: r.notes.join('; '),
      })),
    ],
    [
      'Ageing Buckets',
      p.agingBucketSummary.map((b) => ({ Bucket: `${b.bucket} days`, Invoices: b.count, Amount: money(b.amount) })),
    ],
    [
      'Stopped Visiting',
      p.atRiskPatients.map((a) => ({
        'Patient ID': a.patientId, Patient: a.patientName, 'First Visit': a.firstVisit, 'Last Visit': a.lastVisit,
        'Days Since Last Visit': a.daysSinceLastVisit, 'Lifetime Visits': a.lifetimeVisits, 'Lifetime Revenue': money(a.lifetimeRevenue),
      })),
    ],
    [
      'Returned Patients',
      p.returnedPatients.map((r) => ({
        'Patient ID': r.patientId, Patient: r.patientName, 'Went Quiet On': r.wentQuietOn, 'Gap (days)': r.gapDays,
        'Returned On': r.returnedOn, 'Days Since Return': r.daysSinceReturn, 'Visits Since Return': r.visitsSinceReturn,
        'Revenue Since Return': money(r.revenueSinceReturn), 'Still Active': r.currentlyActive ? 'Yes' : 'No',
      })),
    ],
    ['Transactions', transactionRows(p)],
  ];

  for (const [name, rows] of sheets) {
    const ws = rows.length > 0 ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([['No data for this period']]);
    if (rows.length > 0) ws['!cols'] = columnWidths(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  XLSX.writeFile(wb, `patient-matrix-${p.range.start}-to-${p.range.end}.xlsx`);
}
