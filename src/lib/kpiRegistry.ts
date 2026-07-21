import type { SaleRecord } from '../types';
import { isInRange, previousPeriod, type DateRange, type PatientVisitSummary } from './metrics';

export interface ParsedTarget {
  /** Raw text as it appeared in the offer letter, e.g. "OMR 15,000 - 25,000" or "Minimum 35%". */
  raw: string;
  min?: number;
  max?: number;
}

/**
 * Best-effort numeric range parser for free-text KPI targets. Every computable target in this
 * HR template's KPI tables is "higher is better" (a revenue floor, a growth percentage, a patient
 * count, a retention rate) - none of the computable ones are "lower is better" (like response
 * time), so a single min/max range with that convention covers all of them without needing a
 * direction flag.
 */
export function parseTarget(text: string): ParsedTarget {
  const numbers = [...text.matchAll(/[\d,]+(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, '')));
  if (numbers.length >= 2) return { raw: text, min: numbers[0], max: numbers[1] };
  if (numbers.length === 1) {
    const isCeiling = /\b(max|maximum|up to|≤|at most)\b/i.test(text);
    return isCeiling ? { raw: text, max: numbers[0] } : { raw: text, min: numbers[0] };
  }
  return { raw: text };
}

export type KpiStatus = 'meets' | 'below' | 'unknown';

function statusFor(actual: number, target: ParsedTarget): KpiStatus {
  if (target.min == null && target.max == null) return 'unknown';
  if (target.min != null && actual < target.min) return 'below';
  if (target.max != null && target.min == null && actual > target.max) return 'unknown'; // a pure ceiling target isn't a shortfall to flag as "below"
  return 'meets';
}

export interface KpiComputation {
  actual: number;
  unit: 'currency' | 'percent' | 'count';
  status: KpiStatus;
  periodLabel: string;
  /** The underlying figures the actual was derived from (e.g. this month's total and the prior-months average it's compared against), shown alongside the computed result rather than hidden behind it. */
  breakdown?: { label: string; value: number; unit: 'currency' | 'percent' | 'count' }[];
}

export interface KpiDefinition {
  id: string;
  /** All of these substrings must appear (case-insensitive) in the KPI's metric name for this definition to match it. */
  keywords: string[];
  unit: 'currency' | 'percent' | 'count';
  isQuarterly: boolean;
  compute: (
    records: SaleRecord[],
    patients: Map<string, PatientVisitSummary>,
    target: ParsedTarget,
    asOfISO: string,
  ) => KpiComputation;
}

function monthRange(asOfISO: string): DateRange {
  const d = new Date(`${asOfISO}T00:00:00`);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: toISO(start), end: toISO(end) };
}

function quarterRange(asOfISO: string): DateRange {
  const d = new Date(`${asOfISO}T00:00:00`);
  const qStartMonth = Math.floor(d.getMonth() / 3) * 3;
  const start = new Date(d.getFullYear(), qStartMonth, 1);
  const end = new Date(d.getFullYear(), qStartMonth + 3, 0);
  return { start: toISO(start), end: toISO(end) };
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthRangeForKey(monthKey: string): DateRange {
  const [year, month] = monthKey.split('-').map(Number);
  return { start: `${monthKey}-01`, end: toISO(new Date(year, month, 0)) };
}

/**
 * Every distinct yyyy-mm month with any activity in `records`, excluding whatever
 * `currentRange` covers - the denominator for a fair "average per prior month". Using only
 * months where the specific thing being measured happened (e.g. only months with a package
 * sale) would silently drop genuine zero-count months from the average and inflate it.
 */
function priorMonthKeys(records: SaleRecord[], currentRange: DateRange): string[] {
  const months = new Set<string>();
  for (const r of records) {
    if (isInRange(r.date, currentRange)) continue;
    months.add(r.date.slice(0, 7));
  }
  return [...months];
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

export const KPI_REGISTRY: KpiDefinition[] = [
  {
    id: 'monthlyRevenue',
    // Deliberately "monthly" + "revenue" rather than "revenue" + "contribution" - the latter
    // also matches unrelated metrics like "Partnership Revenue Contribution" (a % breakdown,
    // not a revenue total).
    keywords: ['monthly', 'revenue'],
    unit: 'currency',
    isQuarterly: false,
    compute: (records, _patients, target, asOfISO) => {
      const range = monthRange(asOfISO);
      const currentMonthRevenue = records.filter((r) => isInRange(r.date, range)).reduce((sum, r) => sum + r.amount, 0);

      // This is an "Additional"/incremental contribution target, not a share of total clinic
      // revenue - a growth role's target is revenue ADDED beyond the clinic's existing
      // baseline, so the actual is this month's revenue minus the average of every other
      // complete calendar month present in the data (the baseline), not the raw monthly total.
      // Every prior month with any activity counts toward the average, including a genuine
      // zero-revenue month, not just months that happen to have a matching record.
      const months = priorMonthKeys(records, range);
      const perMonthRevenue = months.map((monthKey) => {
        const mRange = monthRangeForKey(monthKey);
        return records.filter((r) => isInRange(r.date, mRange)).reduce((sum, r) => sum + r.amount, 0);
      });
      const averagePriorMonthly = average(perMonthRevenue);

      const actual = currentMonthRevenue - averagePriorMonthly;
      return {
        actual,
        unit: 'currency',
        status: statusFor(actual, target),
        periodLabel: 'this month vs. average of prior months',
        breakdown: [
          { label: 'This month', value: currentMonthRevenue, unit: 'currency' },
          { label: `Prior months avg (${months.length})`, value: averagePriorMonthly, unit: 'currency' },
        ],
      };
    },
  },
  {
    id: 'revenueGrowthQoQ',
    keywords: ['revenue', 'growth'],
    unit: 'percent',
    isQuarterly: true,
    compute: (records, _patients, target, asOfISO) => {
      const range = quarterRange(asOfISO);
      const prevRange = previousPeriod(range);
      const current = records.filter((r) => isInRange(r.date, range)).reduce((sum, r) => sum + r.amount, 0);
      const prev = records.filter((r) => isInRange(r.date, prevRange)).reduce((sum, r) => sum + r.amount, 0);
      const actual = prev > 0 ? ((current - prev) / prev) * 100 : 0;
      return {
        actual,
        unit: 'percent',
        status: statusFor(actual, target),
        periodLabel: 'this quarter vs last',
        breakdown: [
          { label: 'This quarter', value: current, unit: 'currency' },
          { label: 'Last quarter', value: prev, unit: 'currency' },
        ],
      };
    },
  },
  {
    id: 'avgTransactionValue',
    keywords: ['average', 'transaction'],
    unit: 'currency',
    isQuarterly: false,
    compute: (records, _patients, target, asOfISO) => {
      const range = quarterRange(asOfISO);
      const prevRange = previousPeriod(range);
      const cur = records.filter((r) => isInRange(r.date, range));
      const prev = records.filter((r) => isInRange(r.date, prevRange));
      const curAvg = cur.length > 0 ? cur.reduce((s, r) => s + r.amount, 0) / cur.length : 0;
      const prevAvg = prev.length > 0 ? prev.reduce((s, r) => s + r.amount, 0) / prev.length : 0;
      const actual = prevAvg > 0 ? ((curAvg - prevAvg) / prevAvg) * 100 : 0;
      return {
        actual,
        unit: 'percent',
        status: statusFor(actual, target),
        periodLabel: 'this quarter vs last',
        breakdown: [
          { label: 'This quarter avg', value: curAvg, unit: 'currency' },
          { label: 'Last quarter avg', value: prevAvg, unit: 'currency' },
        ],
      };
    },
  },
  {
    id: 'packageSales',
    keywords: ['package', 'sales'],
    unit: 'count',
    isQuarterly: false,
    compute: (records, _patients, target, asOfISO) => {
      const range = monthRange(asOfISO);
      const countPackageInvoices = (r: DateRange) =>
        new Set(records.filter((rec) => isInRange(rec.date, r) && rec.itemType === 'Package').map((rec) => rec.invoiceNo)).size;
      const actual = countPackageInvoices(range);

      const months = priorMonthKeys(records, range);
      const averagePriorMonthly = average(months.map((monthKey) => countPackageInvoices(monthRangeForKey(monthKey))));

      return {
        actual,
        unit: 'count',
        status: statusFor(actual, target),
        periodLabel: 'this month',
        breakdown: [
          { label: 'This month', value: actual, unit: 'count' },
          { label: `Prior months avg (${months.length})`, value: averagePriorMonthly, unit: 'count' },
        ],
      };
    },
  },
  {
    id: 'newPatients',
    keywords: ['new patient'],
    unit: 'count',
    isQuarterly: false,
    compute: (records, patients, target, asOfISO) => {
      const countNewPatients = (r: DateRange) => {
        const activeSet = new Set(records.filter((rec) => isInRange(rec.date, r)).map((rec) => rec.patientId));
        let count = 0;
        for (const id of activeSet) {
          const s = patients.get(id);
          if (s && isInRange(s.firstVisit, r)) count++;
        }
        return count;
      };

      const range = monthRange(asOfISO);
      const actual = countNewPatients(range);

      const months = priorMonthKeys(records, range);
      const averagePriorMonthly = average(months.map((monthKey) => countNewPatients(monthRangeForKey(monthKey))));

      return {
        actual,
        unit: 'count',
        status: statusFor(actual, target),
        periodLabel: 'this month',
        breakdown: [
          { label: 'This month', value: actual, unit: 'count' },
          { label: `Prior months avg (${months.length})`, value: averagePriorMonthly, unit: 'count' },
        ],
      };
    },
  },
  {
    id: 'retentionRate',
    keywords: ['retention'],
    unit: 'percent',
    isQuarterly: false,
    compute: (records, patients, target, asOfISO) => {
      // "return visits within 6 months" - patients active 6 months ago who visited again anytime since.
      const asOf = new Date(`${asOfISO}T00:00:00`);
      const windowStart = new Date(asOf.getFullYear(), asOf.getMonth() - 6, asOf.getDate());
      const baselineRange: DateRange = { start: toISO(windowStart), end: toISO(asOf) };
      const cohort = new Set(records.filter((r) => isInRange(r.date, baselineRange)).map((r) => r.patientId));
      let retained = 0;
      for (const id of cohort) {
        const s = patients.get(id);
        if (s && s.lifetimeVisits > 1) retained++;
      }
      const actual = cohort.size > 0 ? (retained / cohort.size) * 100 : 0;
      return {
        actual,
        unit: 'percent',
        status: statusFor(actual, target),
        periodLabel: 'last 6 months',
        breakdown: [
          { label: 'Returned', value: retained, unit: 'count' },
          { label: 'Cohort (active 6mo ago)', value: cohort.size, unit: 'count' },
        ],
      };
    },
  },
];

export function findKpiDefinition(metricName: string): KpiDefinition | null {
  const lower = metricName.toLowerCase();
  return KPI_REGISTRY.find((def) => def.keywords.every((k) => lower.includes(k))) ?? null;
}
