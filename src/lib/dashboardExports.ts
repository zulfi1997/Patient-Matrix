import type { StaffScorecard } from '../types';
import type {
  FlaggedBreakdownStat,
  FlaggedDueInvoice,
  FlaggedMonthlyPoint,
  FlaggedSummary,
  FlaggedTransaction,
  MonthlyTrendPoint,
  NewPatientDetail,
  NewPatientRevenueSummary,
  NewPatientServiceStat,
} from './metrics';
import type { AcquisitionCostInputs } from './acquisitionCost';
import type {
  DepartmentMonthlyActivityRow,
  DepartmentPatientActivityRow,
  DepartmentProviderRow,
  DepartmentRedemptionRow,
  DepartmentRevenueRow,
} from './departmentAnalytics';
import type { SegmentPnlResult } from './segmentAllocation';
import type { KpiDefinition, KpiPeriodValue, KpiPoint } from './kpiCatalog';
import type { ProviderConversionStat, PatientConversionRow } from './conversionMetrics';
import { money, pct, type WorkbookSheet } from './workbook';

/** Common first sheet, so a workbook opened weeks later still says what it covers. */
export function contextSheet(rows: [string, string | number][]): WorkbookSheet {
  return { name: 'Read Me', rows: rows.map(([Item, Detail]) => ({ Item, Detail })) };
}

export function newPatientRevenueSheets(p: {
  summary: NewPatientRevenueSummary;
  details: NewPatientDetail[];
  topServices: NewPatientServiceStat[];
  trend: MonthlyTrendPoint[];
  acquisition: AcquisitionCostInputs;
  pacNewPatients: number;
}): WorkbookSheet[] {
  const perPatient = (spend: number) => (p.pacNewPatients > 0 ? money(spend / p.pacNewPatients) : '');
  return [
    {
      name: 'Summary',
      rows: [
        { Metric: 'New Patient Revenue', Value: money(p.summary.newPatientRevenue) },
        { Metric: 'Returning Patient Revenue', Value: money(p.summary.returningPatientRevenue) },
        { Metric: 'Total Revenue', Value: money(p.summary.totalRevenue) },
        { Metric: 'New Patients', Value: p.summary.newPatients },
        {
          Metric: 'Share From New Patients (%)',
          Value: p.summary.totalRevenue > 0 ? pct((p.summary.newPatientRevenue / p.summary.totalRevenue) * 100) : '',
        },
        { Metric: 'Ad Campaign Spend', Value: money(p.acquisition.adCampaignSpend) },
        { Metric: 'Total Marketing Spend', Value: money(p.acquisition.totalMarketingSpend) },
        { Metric: 'New Patients (spend basis)', Value: p.pacNewPatients },
        { Metric: 'Acquisition Cost - Ad Campaigns', Value: perPatient(p.acquisition.adCampaignSpend) },
        { Metric: 'Acquisition Cost - Total Marketing', Value: perPatient(p.acquisition.totalMarketingSpend) },
        { Metric: 'Months With P&L Data', Value: p.acquisition.monthsCovered.join(', ') },
      ],
    },
    {
      name: 'Monthly Split',
      rows: p.trend.map((t) => ({
        Month: t.month.slice(0, 7),
        'New Patients': t.newPatients,
        'Returning Patients': t.returningPatients,
        'New Patient Revenue': money(t.newPatientRevenue),
        'Returning Patient Revenue': money(t.returningPatientRevenue),
        'Total Revenue': money(t.revenue),
      })),
    },
    {
      name: 'New Patients',
      rows: p.details.map((d) => ({
        'Patient ID': d.patientId,
        Patient: d.patientName,
        'First Visit': d.firstVisitDate,
        'Services On First Visit': d.services.join('; '),
        'First Visit Revenue': money(d.revenue),
      })),
    },
    {
      name: 'First Visit Services',
      rows: p.topServices.map((s) => ({ Service: s.serviceName, 'New Patients': s.patientCount, Revenue: money(s.revenue) })),
    },
  ];
}

export function flaggedSheets(p: {
  summary: FlaggedSummary;
  transactions: FlaggedTransaction[];
  byStaff: FlaggedBreakdownStat[];
  byService: FlaggedBreakdownStat[];
  trend: FlaggedMonthlyPoint[];
  dueInvoices: FlaggedDueInvoice[];
}): WorkbookSheet[] {
  return [
    {
      name: 'Summary',
      rows: [
        { Metric: 'Flagged Line Items', Value: p.summary.count },
        { Metric: 'Flagged Value', Value: money(p.summary.amount) },
        { Metric: 'Distinct Patients', Value: p.summary.distinctPatients },
        { Metric: 'Distinct Staff', Value: p.summary.distinctStaff },
        { Metric: 'Flagged Invoices Still Due', Value: p.dueInvoices.length },
        { Metric: 'Value Still Due', Value: money(p.dueInvoices.reduce((s, i) => s + i.dueAmount, 0)) },
      ],
    },
    {
      name: 'Transactions',
      rows: p.transactions.map((t) => ({
        Date: t.date, Month: t.date.slice(0, 7), 'Invoice No': t.invoiceNo,
        'Patient ID': t.patientId, Patient: t.patientName, Staff: t.staff ?? '',
        'Item Type': t.itemType, Service: t.serviceName, Amount: money(t.amount), 'Invoice Notes': t.notes,
      })),
    },
    { name: 'By Staff', rows: p.byStaff.map((s) => ({ Staff: s.key, 'Line Items': s.count, Amount: money(s.amount) })) },
    { name: 'By Service', rows: p.byService.map((s) => ({ Service: s.key, 'Line Items': s.count, Amount: money(s.amount) })) },
    { name: 'Monthly Trend', rows: p.trend.map((t) => ({ Month: t.month.slice(0, 7), 'Line Items': t.count, Amount: money(t.amount) })) },
    {
      name: 'Due Invoices',
      rows: p.dueInvoices.map((i) => ({
        'Invoice No': i.invoiceNo, 'Patient ID': i.patientId, Patient: i.patientName, Date: i.date,
        Services: i.services.join('; '), Status: i.invoiceStatus, Due: money(i.dueAmount),
      })),
    },
  ];
}

export function departmentSheets(p: {
  revenue: DepartmentRevenueRow[];
  providers: DepartmentProviderRow[];
  redemptions: DepartmentRedemptionRow[];
  patients: DepartmentPatientActivityRow[];
  monthly: DepartmentMonthlyActivityRow[];
}): WorkbookSheet[] {
  const total = p.revenue.reduce((s, r) => s + r.revenue, 0);
  return [
    {
      name: 'Revenue By Department',
      rows: p.revenue.map((r) => ({
        Department: r.department,
        Revenue: money(r.revenue),
        'Prior Period Revenue': money(r.previousRevenue),
        'Change (%)': r.previousRevenue > 0 ? pct(((r.revenue - r.previousRevenue) / r.previousRevenue) * 100) : '',
        'Share (%)': total > 0 ? pct((r.revenue / total) * 100) : '',
        'Package Value Redeemed': money(r.redeemedValue),
        Transactions: r.transactions,
      })),
    },
    {
      name: 'Provider Contribution',
      rows: p.providers.map((r) => ({ Department: r.department, Provider: r.provider, Revenue: money(r.revenue), Transactions: r.transactions })),
    },
    {
      name: 'Package Redemptions',
      rows: p.redemptions.map((r) => ({ Department: r.department, Provider: r.provider, Redemptions: r.redemptions, 'Value Redeemed': money(r.redeemedValue) })),
    },
    {
      name: 'Patient Activity',
      rows: p.patients.map((r) => ({
        Department: r.department, 'Active Patients': r.activePatients, 'New Patients': r.newPatients, 'Returning Patients': r.returningPatients,
      })),
    },
    {
      name: 'Monthly Activity',
      rows: p.monthly.map((r) => ({
        Month: r.month.slice(0, 7), Department: r.department,
        'Active Patients': r.activePatients, 'New Patients': r.newPatients, 'Returning Patients': r.returningPatients,
      })),
    },
  ];
}

export function segmentPnlSheets(results: SegmentPnlResult[]): WorkbookSheet[] {
  return [
    {
      name: 'Segment Totals',
      rows: results.map((r) => ({
        Segment: r.segment,
        Income: money(r.ownTotals.income + r.allocatedTotals.income),
        COGS: money(r.ownTotals.cogs + r.allocatedTotals.cogs),
        'Gross Profit': money(r.ownTotals.grossProfit + r.allocatedTotals.grossProfit),
        Expense: money(r.ownTotals.expense + r.allocatedTotals.expense),
        'Other Income': money(r.ownTotals.otherIncome + r.allocatedTotals.otherIncome),
        'Other Expense': money(r.ownTotals.otherExpense + r.allocatedTotals.otherExpense),
        'Net Profit': money(r.ownTotals.netProfit + r.allocatedTotals.netProfit),
        'Own Net Profit': money(r.ownTotals.netProfit),
        'Allocated Net Profit': money(r.allocatedTotals.netProfit),
      })),
    },
    {
      // Own and allocated kept in separate columns: the allocated share is an apportionment of
      // shared overhead, not something the segment itself posted, and merging them hides that.
      name: 'Line Detail',
      rows: results.flatMap((r) =>
        r.lines.map((l) => ({
          Segment: r.segment, Section: l.section, Group: l.group ?? '', Description: l.description,
          'Own Amount': money(l.ownAmount), 'Allocated Share': money(l.allocatedAmount), Total: money(l.total),
        })),
      ),
    },
  ];
}

export function staffScorecardSheets(scorecards: StaffScorecard[]): WorkbookSheet[] {
  return [
    {
      name: 'Scorecards',
      rows: scorecards.map((s) => ({
        Employee: s.employeeName, Role: s.roleTitle, 'Source File': s.fileName,
        Uploaded: s.uploadedAt.slice(0, 10), 'KPI Count': s.kpis.length,
      })),
    },
    {
      name: 'KPIs',
      rows: scorecards.flatMap((s) =>
        s.kpis.map((k) => ({
          Employee: s.employeeName, Role: s.roleTitle, Category: k.category,
          Metric: k.metric, Target: k.target, 'Measurement Method': k.measurementMethod,
        })),
      ),
    },
  ];
}

export function kpiEvaluationSheets(p: {
  kpis: KpiDefinition[];
  periodValueById: Map<string, KpiPeriodValue>;
  seriesById: Map<string, KpiPoint[]>;
}): WorkbookSheet[] {
  return [
    {
      name: 'KPI Summary',
      rows: p.kpis.map((k) => {
        const v = p.periodValueById.get(k.id);
        return {
          KPI: k.label, Category: k.category, Unit: k.unit,
          Current: v ? money(v.current) : '', 'Prior Period': v ? money(v.previous) : '',
          'Change (%)': v ? pct(v.changePct) : '', Description: k.description,
        };
      }),
    },
    {
      // Long rather than one column per KPI: a pivot handles long shape, and the wide form breaks
      // as soon as the selected KPIs change.
      name: 'Monthly Series',
      rows: p.kpis.flatMap((k) =>
        (p.seriesById.get(k.id) ?? []).map((pt) => ({
          Month: pt.month.slice(0, 7), KPI: k.label, Category: k.category, Unit: k.unit, Value: money(pt.value),
        })),
      ),
    },
  ];
}

export function conversionSheets(p: {
  providers: ProviderConversionStat[];
  /** Omitted when the workbook is already scoped to a single provider - a totals row identical to the only data row reads as a second provider. */
  overall?: ProviderConversionStat | null;
  patientRows: PatientConversionRow[];
  categoryLabels: Record<string, string>;
  followUpLabels: Record<string, string>;
}): WorkbookSheet[] {
  const statRow = (s: ProviderConversionStat) => ({
    Provider: s.staff,
    'New - Unconverted': s.newUnconverted,
    'New - Converted': s.newConverted,
    'Repeat - Unconverted': s.repeatUnconverted,
    'Repeat - Converted': s.repeatConverted,
    'Follow-up / Direct Service': s.followUp,
    'Follow-up: YB111': s.followUpByReason.yb111,
    'Follow-up: Package Redemption': s.followUpByReason.packageRedemption,
    'Follow-up: Package Balance': s.followUpByReason.packageBalance,
    'Total Patients': s.total,
    'Conversion Rate (%)': pct(s.conversionRate),
    Revenue: money(s.revenue),
    'Revenue Adjustment': money(s.revenueAdjustment),
  });
  return [
    {
      name: 'By Provider',
      rows: [...p.providers.map(statRow), ...(p.overall ? [statRow({ ...p.overall, staff: 'All Providers' })] : [])],
    },
    {
      name: 'Patient Detail',
      rows: p.patientRows.map((r) => ({
        Date: r.date, Month: r.date.slice(0, 7), 'Patient ID': r.patientId, Patient: r.patientName,
        Provider: r.staff, Category: p.categoryLabels[r.category] ?? r.category,
        'Follow-up Reason': r.followUpReason ? (p.followUpLabels[r.followUpReason] ?? r.followUpReason) : '',
        Revenue: money(r.revenue), Services: r.services.join('; '),
      })),
    },
    // The same rows split by category and ordered by provider. Patient Detail above already holds
    // all of it, but answering "who were Fatima's new patients" from it means filtering two
    // columns first; these are usable as they land.
    named('New Patients', p, ['newUnconverted', 'newConverted']),
    named('Repeat Patients', p, ['repeatUnconverted', 'repeatConverted']),
    named('Follow-ups', p, ['followUp']),
  ];
}

/** One category's patients, grouped by provider then date, with conversion stated per row. */
function named(
  name: string,
  p: { patientRows: PatientConversionRow[]; followUpLabels: Record<string, string> },
  categories: string[],
): WorkbookSheet {
  const wanted = new Set(categories);
  const rows = p.patientRows
    .filter((r) => wanted.has(r.category))
    .sort((a, b) => a.staff.localeCompare(b.staff) || a.date.localeCompare(b.date) || a.patientName.localeCompare(b.patientName))
    .map((r) => ({
      Provider: r.staff,
      Date: r.date,
      Month: r.date.slice(0, 7),
      'Patient ID': r.patientId,
      Patient: r.patientName,
      // Blank rather than "No" for a follow-up: it was never a conversion opportunity, so saying
      // it did not convert would misread as a failure.
      Converted: r.category === 'followUp' ? '' : r.category.endsWith('Converted') ? 'Yes' : 'No',
      'Follow-up Reason': r.followUpReason ? (p.followUpLabels[r.followUpReason] ?? r.followUpReason) : '',
      Revenue: money(r.revenue),
      Services: r.services.join('; '),
    }));
  return { name, rows };
}
