import type { SaleRecord } from '../types';
import { formatCurrencyCompact, formatNumber, formatPercent, toISODate } from './format';
import {
  computeFlaggedMonthlyTrend,
  computeMonthlyTrend,
  daysBetween,
  isInRange,
  summarizePatients,
  type DateRange,
  type FlaggedMonthlyPoint,
  type MonthlyTrendPoint,
  type PatientVisitSummary,
} from './metrics';
import { hasFlaggedNote } from './filters';

export type KpiCategory = 'revenue' | 'patient' | 'staff' | 'service';
export type KpiUnit = 'currency' | 'count' | 'percent';

export interface KpiPoint {
  month: string;
  value: number;
}

export interface KpiContext {
  records: SaleRecord[];
  patients: Map<string, PatientVisitSummary>;
  asOfISO: string;
  monthsBack: number;
  monthRanges: DateRange[];
  trend: MonthlyTrendPoint[];
  flaggedTrend: FlaggedMonthlyPoint[];
}

export interface KpiDefinition {
  id: string;
  label: string;
  category: KpiCategory;
  unit: KpiUnit;
  description: string;
  compute: (ctx: KpiContext) => KpiPoint[];
}

export function buildMonthRanges(asOfISO: string, monthsBack: number): DateRange[] {
  const asOf = new Date(`${asOfISO}T00:00:00`);
  const ranges: DateRange[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const start = new Date(asOf.getFullYear(), asOf.getMonth() - i, 1);
    const end = new Date(asOf.getFullYear(), asOf.getMonth() - i + 1, 0);
    ranges.push({ start: toISODate(start), end: toISODate(end) });
  }
  return ranges;
}

export function buildKpiContext(records: SaleRecord[], asOfISO: string, monthsBack: number): KpiContext {
  const patients = summarizePatients(records);
  return {
    records,
    patients,
    asOfISO,
    monthsBack,
    monthRanges: buildMonthRanges(asOfISO, monthsBack),
    trend: computeMonthlyTrend(records, patients, monthsBack, asOfISO),
    flaggedTrend: computeFlaggedMonthlyTrend(records, monthsBack, asOfISO),
  };
}

/** Sum of a per-record numeric field within range, filtered by an optional predicate. */
function sumByMonth(
  ctx: KpiContext,
  valueFn: (r: SaleRecord) => number,
  filterFn?: (r: SaleRecord) => boolean,
): KpiPoint[] {
  return ctx.monthRanges.map((range) => {
    let sum = 0;
    for (const r of ctx.records) {
      if (!isInRange(r.date, range)) continue;
      if (filterFn && !filterFn(r)) continue;
      sum += valueFn(r);
    }
    return { month: range.start, value: sum };
  });
}

function distinctCountByMonth(ctx: KpiContext, keyFn: (r: SaleRecord) => string | null): KpiPoint[] {
  return ctx.monthRanges.map((range) => {
    const set = new Set<string>();
    for (const r of ctx.records) {
      if (!isInRange(r.date, range)) continue;
      const key = keyFn(r);
      if (key) set.add(key);
    }
    return { month: range.start, value: set.size };
  });
}

export const KPI_CATALOG: KpiDefinition[] = [
  // --- Revenue ---
  {
    id: 'revenue-total',
    label: 'Total Revenue',
    category: 'revenue',
    unit: 'currency',
    description: 'Net revenue per month (excludes package-redemption double-counting).',
    compute: (ctx) => ctx.trend.map((m) => ({ month: m.month, value: m.revenue })),
  },
  {
    id: 'revenue-avg-transaction',
    label: 'Average Transaction Value',
    category: 'revenue',
    unit: 'currency',
    description: 'Revenue divided by number of line items, per month.',
    compute: (ctx) => ctx.trend.map((m) => ({ month: m.month, value: m.transactions > 0 ? m.revenue / m.transactions : 0 })),
  },
  {
    id: 'revenue-growth-rate',
    label: 'Revenue Growth Rate',
    category: 'revenue',
    unit: 'percent',
    description: 'Month-over-month % change in revenue.',
    compute: (ctx) =>
      ctx.trend.map((m, i) => {
        const prev = ctx.trend[i - 1];
        const value = prev && prev.revenue > 0 ? ((m.revenue - prev.revenue) / prev.revenue) * 100 : 0;
        return { month: m.month, value };
      }),
  },
  {
    id: 'revenue-service',
    label: 'Service Revenue',
    category: 'revenue',
    unit: 'currency',
    description: 'Revenue from Item Type = Service, per month.',
    compute: (ctx) => sumByMonth(ctx, (r) => r.amount, (r) => r.itemType === 'Service'),
  },
  {
    id: 'revenue-package',
    label: 'Package Revenue',
    category: 'revenue',
    unit: 'currency',
    description: 'Revenue from new package purchases (Item Type = Package), per month.',
    compute: (ctx) => sumByMonth(ctx, (r) => r.amount, (r) => r.itemType === 'Package'),
  },

  // --- Patient ---
  {
    id: 'patient-new',
    label: 'New Patients',
    category: 'patient',
    unit: 'count',
    description: 'Patients whose first-ever visit fell in that month.',
    compute: (ctx) => ctx.trend.map((m) => ({ month: m.month, value: m.newPatients })),
  },
  {
    id: 'patient-returning',
    label: 'Returning Patients',
    category: 'patient',
    unit: 'count',
    description: 'Active patients that month who had visited before.',
    compute: (ctx) => ctx.trend.map((m) => ({ month: m.month, value: m.returningPatients })),
  },
  {
    id: 'patient-active',
    label: 'Active Patients',
    category: 'patient',
    unit: 'count',
    description: 'Distinct patients with at least one visit that month.',
    compute: (ctx) => ctx.trend.map((m) => ({ month: m.month, value: m.activePatients })),
  },
  {
    id: 'patient-retention-rate',
    label: 'Retention Rate',
    category: 'patient',
    unit: 'percent',
    description: "Of last month's active patients, % who also visited this month.",
    compute: (ctx) => ctx.trend.map((m) => ({ month: m.month, value: m.retentionRate ?? 0 })),
  },
  {
    id: 'patient-turnover-rate',
    label: 'Turnover Rate',
    category: 'patient',
    unit: 'percent',
    description: "Of last month's active patients, % who did not return.",
    compute: (ctx) =>
      ctx.trend.map((m) => ({
        month: m.month,
        value: m.prevMonthActivePatients > 0 ? ((m.prevMonthActivePatients - m.retainedPatients) / m.prevMonthActivePatients) * 100 : 0,
      })),
  },
  {
    id: 'patient-stopped-visiting',
    label: 'Patients Stopped Visiting (90d+)',
    category: 'patient',
    unit: 'count',
    description: 'As of each month-end, patients inactive 90+ days (using only data known up to that point).',
    compute: (ctx) =>
      ctx.monthRanges.map((range) => {
        const upToNow = ctx.records.filter((r) => r.date <= range.end);
        const snapshot = summarizePatients(upToNow);
        let count = 0;
        for (const s of snapshot.values()) {
          if (daysBetween(s.lastVisit, range.end) >= 90) count++;
        }
        return { month: range.start, value: count };
      }),
  },

  // --- Staff ---
  {
    id: 'staff-active-count',
    label: 'Active Staff Count',
    category: 'staff',
    unit: 'count',
    description: 'Distinct staff (Sold By/Therapist) with at least one transaction that month.',
    compute: (ctx) => distinctCountByMonth(ctx, (r) => r.staff),
  },
  {
    id: 'staff-avg-revenue',
    label: 'Average Revenue per Staff',
    category: 'staff',
    unit: 'currency',
    description: 'Total revenue divided by distinct active staff, per month.',
    compute: (ctx) => {
      const revenue = sumByMonth(ctx, (r) => r.amount);
      const staffCount = distinctCountByMonth(ctx, (r) => r.staff);
      return revenue.map((m, i) => ({ month: m.month, value: staffCount[i].value > 0 ? m.value / staffCount[i].value : 0 }));
    },
  },
  {
    id: 'staff-yb111-count',
    label: '"YB111" Flagged Transactions',
    category: 'staff',
    unit: 'count',
    description: 'Line items flagged "YB111" in Invoice Notes, per month.',
    compute: (ctx) => ctx.flaggedTrend.map((m) => ({ month: m.month, value: m.count })),
  },
  {
    id: 'staff-yb111-value',
    label: '"YB111" Flagged Value',
    category: 'staff',
    unit: 'currency',
    description: 'Revenue value on "YB111"-flagged line items, per month.',
    compute: (ctx) => ctx.flaggedTrend.map((m) => ({ month: m.month, value: m.amount })),
  },

  // --- Service ---
  {
    id: 'service-distinct-count',
    label: 'Distinct Services Sold',
    category: 'service',
    unit: 'count',
    description: 'Number of distinct services with at least one sale that month.',
    compute: (ctx) => distinctCountByMonth(ctx, (r) => (r.itemType === 'Service' ? r.serviceKey : null)),
  },
  {
    id: 'service-product-revenue',
    label: 'Product Revenue',
    category: 'service',
    unit: 'currency',
    description: 'Revenue from Item Type = Product, per month.',
    compute: (ctx) => sumByMonth(ctx, (r) => r.amount, (r) => r.itemType === 'Product'),
  },
  {
    id: 'service-redeemed-value',
    label: 'Package Redemption Value',
    category: 'service',
    unit: 'currency',
    description: "Value of previously-sold packages' sessions redeemed that month.",
    compute: (ctx) => sumByMonth(ctx, (r) => r.redeemedAmount, (r) => !!r.packageName),
  },
  {
    id: 'service-redeemed-count',
    label: 'Package Sessions Redeemed',
    category: 'service',
    unit: 'count',
    description: 'Number of line items redeeming a session from a previously sold package, per month.',
    compute: (ctx) => sumByMonth(ctx, () => 1, (r) => !!r.packageName),
  },
  {
    id: 'service-flagged-share',
    label: '"YB111" Share of Service Lines',
    category: 'service',
    unit: 'percent',
    description: '% of Service line items that month flagged "YB111".',
    compute: (ctx) =>
      ctx.monthRanges.map((range) => {
        let total = 0;
        let flagged = 0;
        for (const r of ctx.records) {
          if (!isInRange(r.date, range) || r.itemType !== 'Service') continue;
          total++;
          if (hasFlaggedNote(r)) flagged++;
        }
        return { month: range.start, value: total > 0 ? (flagged / total) * 100 : 0 };
      }),
  },
];

export function getKpiDefinition(id: string): KpiDefinition | undefined {
  return KPI_CATALOG.find((k) => k.id === id);
}

export function formatKpiValue(value: number, unit: KpiUnit): string {
  if (unit === 'currency') return formatCurrencyCompact(value);
  if (unit === 'percent') return formatPercent(value, 1);
  return formatNumber(Math.round(value));
}

/** Pearson correlation coefficient between two equal-length numeric series. NaN if fewer than 3 points or no variance. */
export function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

export interface KpiCorrelation {
  aId: string;
  bId: string;
  coefficient: number;
}

export function computeCorrelationMatrix(selected: { id: string; points: KpiPoint[] }[]): KpiCorrelation[] {
  const results: KpiCorrelation[] = [];
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      const a = selected[i].points.map((p) => p.value);
      const b = selected[j].points.map((p) => p.value);
      results.push({ aId: selected[i].id, bId: selected[j].id, coefficient: pearsonCorrelation(a, b) });
    }
  }
  return results;
}

export function correlationStrengthLabel(coefficient: number): string {
  const abs = Math.abs(coefficient);
  if (abs >= 0.7) return 'strongly';
  if (abs >= 0.4) return 'moderately';
  if (abs >= 0.2) return 'weakly';
  return 'not meaningfully';
}
