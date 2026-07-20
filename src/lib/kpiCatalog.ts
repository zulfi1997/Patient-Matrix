import type { SaleRecord } from '../types';
import { formatCurrencyCompact, formatNumber, formatPercent, toISODate } from './format';
import {
  computeFlaggedSummary,
  computeKpis,
  daysBetween,
  isInRange,
  previousPeriod,
  summarizePatients,
  type DateRange,
  type PatientVisitSummary,
} from './metrics';
import { hasFlaggedNote } from './filters';
import { resolveProvider, type ProviderAssignmentOverride, type ProviderGroup } from './conversionMetrics';

export type KpiCategory = 'revenue' | 'patient' | 'staff' | 'service';
export type KpiUnit = 'currency' | 'count' | 'percent';

export interface KpiPoint {
  month: string;
  value: number;
}

/**
 * Every KPI is defined as a single function computing one number for an
 * arbitrary date range - reused both for the month-by-month sparkline
 * (called once per calendar month) and for the scorecard's period-scoped
 * value (called once for the selected period and once for its prior-period
 * equivalent), exactly mirroring how the Dashboard tab's own KPI cards vs.
 * trend charts relate to its period selector. `providerGroups` folds
 * assisting-nurse names into their doctor's canonical name (Data tab Master
 * Control) - only the Staff KPIs use it, everything else ignores it.
 */
export interface KpiDefinition {
  id: string;
  label: string;
  category: KpiCategory;
  unit: KpiUnit;
  description: string;
  computeRange: (
    records: SaleRecord[],
    patients: Map<string, PatientVisitSummary>,
    range: DateRange,
    asOfISO: string,
    providerGroups: ProviderGroup[],
    providerAssignmentOverrides: ProviderAssignmentOverride[],
  ) => number;
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

function sumInRange(records: SaleRecord[], range: DateRange, valueFn: (r: SaleRecord) => number, filterFn?: (r: SaleRecord) => boolean): number {
  let sum = 0;
  for (const r of records) {
    if (!isInRange(r.date, range)) continue;
    if (filterFn && !filterFn(r)) continue;
    sum += valueFn(r);
  }
  return sum;
}

function countDistinctInRange(records: SaleRecord[], range: DateRange, keyFn: (r: SaleRecord) => string | null): number {
  const set = new Set<string>();
  for (const r of records) {
    if (!isInRange(r.date, range)) continue;
    const key = keyFn(r);
    if (key) set.add(key);
  }
  return set.size;
}

export const KPI_CATALOG: KpiDefinition[] = [
  // --- Revenue ---
  {
    id: 'revenue-total',
    label: 'Total Revenue',
    category: 'revenue',
    unit: 'currency',
    description: 'Net revenue (excludes package-redemption double-counting).',
    computeRange: (records, _p, range) => sumInRange(records, range, (r) => r.amount),
  },
  {
    id: 'revenue-avg-transaction',
    label: 'Average Transaction Value',
    category: 'revenue',
    unit: 'currency',
    description: 'Revenue divided by number of line items.',
    computeRange: (records, _p, range) => {
      const recs = records.filter((r) => isInRange(r.date, range));
      const revenue = recs.reduce((s, r) => s + r.amount, 0);
      return recs.length > 0 ? revenue / recs.length : 0;
    },
  },
  {
    id: 'revenue-growth-rate',
    label: 'Revenue Growth Rate',
    category: 'revenue',
    unit: 'percent',
    description: '% change in revenue vs. the equivalent prior period.',
    computeRange: (records, _p, range) => {
      const current = sumInRange(records, range, (r) => r.amount);
      const previous = sumInRange(records, previousPeriod(range), (r) => r.amount);
      return previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : 0;
    },
  },
  {
    id: 'revenue-service',
    label: 'Service Revenue',
    category: 'revenue',
    unit: 'currency',
    description: 'Revenue from Item Type = Service.',
    computeRange: (records, _p, range) =>
      sumInRange(records, range, (r) => r.amount, (r) => r.itemType === 'Service'),
  },
  {
    id: 'revenue-package',
    label: 'Package Revenue',
    category: 'revenue',
    unit: 'currency',
    description: 'Revenue from new package purchases (Item Type = Package).',
    computeRange: (records, _p, range) =>
      sumInRange(records, range, (r) => r.amount, (r) => r.itemType === 'Package'),
  },

  // --- Patient ---
  {
    id: 'patient-new',
    label: 'New Patients',
    category: 'patient',
    unit: 'count',
    description: 'Patients whose first-ever visit fell in this period.',
    computeRange: (records, patients, range) => {
      const active = new Set(records.filter((r) => isInRange(r.date, range)).map((r) => r.patientId));
      let n = 0;
      for (const id of active) {
        const s = patients.get(id);
        if (s && isInRange(s.firstVisit, range)) n++;
      }
      return n;
    },
  },
  {
    id: 'patient-returning',
    label: 'Returning Patients',
    category: 'patient',
    unit: 'count',
    description: 'Active patients this period who had visited before.',
    computeRange: (records, patients, range) => {
      const active = new Set(records.filter((r) => isInRange(r.date, range)).map((r) => r.patientId));
      let returning = 0;
      for (const id of active) {
        const s = patients.get(id);
        if (!(s && isInRange(s.firstVisit, range))) returning++;
      }
      return returning;
    },
  },
  {
    id: 'patient-active',
    label: 'Active Patients',
    category: 'patient',
    unit: 'count',
    description: 'Distinct patients with at least one visit this period.',
    computeRange: (records, _p, range) => countDistinctInRange(records, range, (r) => r.patientId),
  },
  {
    id: 'patient-retention-rate',
    label: 'Retention Rate',
    category: 'patient',
    unit: 'percent',
    description: "Of the prior equivalent period's active patients, % who also visited this period.",
    computeRange: (records, patients, range, asOfISO) => computeKpis(records, range, patients, 90, asOfISO).retentionRate ?? 0,
  },
  {
    id: 'patient-turnover-rate',
    label: 'Turnover Rate',
    category: 'patient',
    unit: 'percent',
    description: "Of the prior equivalent period's active patients, % who did not return.",
    computeRange: (records, patients, range, asOfISO) => computeKpis(records, range, patients, 90, asOfISO).turnoverRate ?? 0,
  },
  {
    id: 'patient-stopped-visiting',
    label: 'Patients Stopped Visiting (90d+)',
    category: 'patient',
    unit: 'count',
    description: 'As of the end of this period, patients inactive 90+ days (using only data known up to that point).',
    computeRange: (records, _p, range) => {
      const upToNow = records.filter((r) => r.date <= range.end);
      const snapshot = summarizePatients(upToNow);
      let count = 0;
      for (const s of snapshot.values()) {
        if (daysBetween(s.lastVisit, range.end) >= 90) count++;
      }
      return count;
    },
  },

  // --- Staff ---
  {
    id: 'staff-active-count',
    label: 'Active Staff Count',
    category: 'staff',
    unit: 'count',
    description: 'Distinct providers (Sold By/Therapist, folded through Master Control provider groups) with at least one transaction this period.',
    computeRange: (records, _p, range, _a, providerGroups, overrides) =>
      countDistinctInRange(records, range, (r) => resolveProvider(r.staff, r.date, providerGroups, overrides)),
  },
  {
    id: 'staff-avg-revenue',
    label: 'Average Revenue per Staff',
    category: 'staff',
    unit: 'currency',
    description: 'Total revenue divided by distinct active providers (folded through Master Control provider groups).',
    computeRange: (records, _p, range, _a, providerGroups, overrides) => {
      const revenue = sumInRange(records, range, (r) => r.amount);
      const staffCount = countDistinctInRange(records, range, (r) => resolveProvider(r.staff, r.date, providerGroups, overrides));
      return staffCount > 0 ? revenue / staffCount : 0;
    },
  },
  {
    id: 'staff-yb111-count',
    label: '"YB111" Flagged Transactions',
    category: 'staff',
    unit: 'count',
    description: 'Line items flagged "YB111" in Invoice Notes.',
    computeRange: (records, _p, range) => computeFlaggedSummary(records, range).count,
  },
  {
    id: 'staff-yb111-value',
    label: '"YB111" Flagged Value',
    category: 'staff',
    unit: 'currency',
    description: 'Revenue value on "YB111"-flagged line items.',
    computeRange: (records, _p, range) => computeFlaggedSummary(records, range).amount,
  },

  // --- Service ---
  {
    id: 'service-distinct-count',
    label: 'Distinct Services Sold',
    category: 'service',
    unit: 'count',
    description: 'Number of distinct services with at least one sale this period.',
    computeRange: (records, _p, range) => countDistinctInRange(records, range, (r) => (r.itemType === 'Service' ? r.serviceKey : null)),
  },
  {
    id: 'service-product-revenue',
    label: 'Product Revenue',
    category: 'service',
    unit: 'currency',
    description: 'Revenue from Item Type = Product.',
    computeRange: (records, _p, range) => sumInRange(records, range, (r) => r.amount, (r) => r.itemType === 'Product'),
  },
  {
    id: 'service-redeemed-value',
    label: 'Package Redemption Value',
    category: 'service',
    unit: 'currency',
    description: "Value of previously-sold packages' sessions redeemed this period.",
    computeRange: (records, _p, range) => sumInRange(records, range, (r) => r.redeemedAmount, (r) => !!r.packageName),
  },
  {
    id: 'service-redeemed-count',
    label: 'Package Sessions Redeemed',
    category: 'service',
    unit: 'count',
    description: 'Line items redeeming a session from a previously sold package.',
    computeRange: (records, _p, range) => sumInRange(records, range, () => 1, (r) => !!r.packageName),
  },
  {
    id: 'service-flagged-share',
    label: '"YB111" Share of Service Lines',
    category: 'service',
    unit: 'percent',
    description: '% of Service line items this period flagged "YB111".',
    computeRange: (records, _p, range) => {
      let total = 0;
      let flagged = 0;
      for (const r of records) {
        if (!isInRange(r.date, range) || r.itemType !== 'Service') continue;
        total++;
        if (hasFlaggedNote(r)) flagged++;
      }
      return total > 0 ? (flagged / total) * 100 : 0;
    },
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

/** Monthly series (for sparklines/correlation), independent of any selected period - same pattern as the Dashboard's trend charts. */
export function computeKpiMonthlySeries(
  kpi: KpiDefinition,
  records: SaleRecord[],
  patients: Map<string, PatientVisitSummary>,
  asOfISO: string,
  monthsBack: number,
  providerGroups: ProviderGroup[] = [],
  providerAssignmentOverrides: ProviderAssignmentOverride[] = [],
): KpiPoint[] {
  return buildMonthRanges(asOfISO, monthsBack).map((range) => ({
    month: range.start,
    value: kpi.computeRange(records, patients, range, asOfISO, providerGroups, providerAssignmentOverrides),
  }));
}

export interface KpiPeriodValue {
  current: number;
  previous: number;
  changePct: number | null;
}

/** Value for the selected period and its prior-period equivalent, for the scorecard's headline number. */
export function computeKpiPeriodValue(
  kpi: KpiDefinition,
  records: SaleRecord[],
  patients: Map<string, PatientVisitSummary>,
  range: DateRange,
  asOfISO: string,
  providerGroups: ProviderGroup[] = [],
  providerAssignmentOverrides: ProviderAssignmentOverride[] = [],
): KpiPeriodValue {
  const current = kpi.computeRange(records, patients, range, asOfISO, providerGroups, providerAssignmentOverrides);
  const previous = kpi.computeRange(records, patients, previousPeriod(range), asOfISO, providerGroups, providerAssignmentOverrides);
  const changePct = previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : null;
  return { current, previous, changePct };
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
