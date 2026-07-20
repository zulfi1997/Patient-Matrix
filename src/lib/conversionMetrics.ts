import type { PackageBenefitRecord, SaleRecord } from '../types';
import { hasFlaggedNote } from './filters';
import type { DateRange, PatientVisitSummary } from './metrics';
import { toISODate } from './format';

/**
 * Provider/Therapist daily conversion, per the clinic's logic:
 * - First visit, 0 revenue that day -> New Unconverted
 * - First visit, revenue that day -> New Converted
 * - Repeat visit, YB111-flagged -> Follow-up/Direct Service (overrides everything else)
 * - Repeat visit, revenue that day -> Repeat Patient Converted
 * - Repeat visit, 0 revenue that day, came for a package redemption -> Follow-up/Direct Service
 * - Repeat visit, 0 revenue that day, no redemption but has package benefit balance ->
 *   Follow-up/Direct Service
 * - Repeat visit, 0 revenue that day, no redemption and no package benefit balance ->
 *   Repeat Patient Unconverted
 *
 * "Revenue" here is SaleRecord.amount, which already excludes Gift/Pre-paid card purchases
 * (filtered out upstream) and package-session redemption value (netted out in amount itself) -
 * exactly matching the logic doc's "excluding Gift Card, Prepaid Card, and Package redemption".
 */
export type ConversionCategory = 'newUnconverted' | 'newConverted' | 'repeatUnconverted' | 'repeatConverted' | 'followUp';
export type FollowUpReason = 'yb111' | 'packageRedemption' | 'packageBalance';

export const FOLLOW_UP_REASON_LABELS: Record<FollowUpReason, string> = {
  yb111: '"YB111" Flagged',
  packageRedemption: 'Package Redemption',
  packageBalance: 'Has Package Balance',
};

/** A group of raw staff names (e.g. assisting nurses) whose invoices should all be counted under one canonical provider (e.g. the doctor they assist). */
export interface ProviderGroup {
  id: string;
  canonicalName: string;
  aliases: string[];
}

/**
 * A temporary, date-scoped exception to the permanent Provider Groups - e.g. a nurse who
 * normally assists Dr. A is reassigned to cover for Dr. B while Dr. A is on leave. Takes
 * priority over Provider Groups for any visit date within [startDate, endDate] (inclusive).
 */
export interface ProviderAssignmentOverride {
  id: string;
  staffName: string;
  canonicalName: string;
  startDate: string; // ISO yyyy-mm-dd, inclusive
  endDate: string; // ISO yyyy-mm-dd, inclusive
  note: string;
}

/** A manual, date-scoped correction: move a specific revenue amount from one provider's total to another's. Does not change any patient's underlying conversion category - only the Revenue column. */
export interface RevenueAdjustment {
  id: string;
  date: string; // ISO yyyy-mm-dd
  fromProvider: string;
  toProvider: string;
  amount: number;
  note: string;
}

/**
 * Folds a raw staff name to its canonical provider name for a given visit date. Checks
 * date-scoped overrides first (temporary reassignments), then falls back to the permanent
 * Provider Groups, then passes the name through unchanged. Case-insensitive, trims whitespace.
 */
export function resolveProvider(
  rawStaff: string | null,
  date: string,
  groups: ProviderGroup[],
  overrides: ProviderAssignmentOverride[] = [],
): string {
  const name = (rawStaff || 'Unassigned').trim();
  const lower = name.toLowerCase();

  for (const o of overrides) {
    if (o.staffName.trim().toLowerCase() === lower && date >= o.startDate && date <= o.endDate) {
      return o.canonicalName.trim();
    }
  }

  for (const g of groups) {
    if (g.canonicalName.trim().toLowerCase() === lower) return g.canonicalName.trim();
    if (g.aliases.some((a) => a.trim().toLowerCase() === lower)) return g.canonicalName.trim();
  }
  return name;
}

export interface PatientConversionRow {
  patientId: string;
  patientName: string;
  staff: string;
  date: string;
  revenue: number;
  category: ConversionCategory;
  followUpReason: FollowUpReason | null;
  services: string[];
  hasPackageRedemption: boolean;
  isYB111: boolean;
  isFirstVisit: boolean;
}

/** If a day has no package-benefit snapshot of its own, the nearest snapshot within this many days (before or after) is used as a best-available estimate; beyond that it's considered too stale and treated as unknown. */
export const SNAPSHOT_STALENESS_CAP_DAYS = 14;

export interface SnapshotUsed {
  /** The "as on" date of the snapshot actually used. */
  snapshotDate: string;
  /** 0 if this date had its own snapshot; >0 if a nearby snapshot was used as an estimate. */
  daysAway: number;
}

/** Finds the snapshot for `date` - exact match first, else the nearest one (either direction) within SNAPSHOT_STALENESS_CAP_DAYS. */
function resolveSnapshotForDate(
  packageBenefitsByDate: Map<string, PackageBenefitRecord[]>,
  date: string,
): { records: PackageBenefitRecord[]; used: SnapshotUsed } | null {
  const exact = packageBenefitsByDate.get(date);
  if (exact) return { records: exact, used: { snapshotDate: date, daysAway: 0 } };

  const target = new Date(`${date}T00:00:00`).getTime();
  let best: { snapshotDate: string; daysAway: number } | null = null;
  for (const snapshotDate of packageBenefitsByDate.keys()) {
    const daysAway = Math.round(Math.abs(new Date(`${snapshotDate}T00:00:00`).getTime() - target) / 86_400_000);
    if (daysAway > SNAPSHOT_STALENESS_CAP_DAYS) continue;
    if (!best || daysAway < best.daysAway) best = { snapshotDate, daysAway };
  }
  if (!best) return null;
  return { records: packageBenefitsByDate.get(best.snapshotDate)!, used: best };
}

export interface ProviderConversionStat {
  staff: string;
  newUnconverted: number;
  newConverted: number;
  repeatUnconverted: number;
  repeatConverted: number;
  followUp: number;
  followUpByReason: Record<FollowUpReason, number>;
  total: number;
  /** (newConverted + repeatConverted) / (newUnconverted + newConverted + repeatUnconverted + repeatConverted); Follow-up/Direct Service is excluded, per the logic doc's formula. */
  conversionRate: number | null;
  /** Sum of SaleRecord.amount for this provider's visits that day, after any manual Revenue Adjustments. */
  revenue: number;
  /** Net effect of Revenue Adjustments applied to this provider on this day (0 if none). */
  revenueAdjustment: number;
}

export interface DailyConversionSummary {
  date: string;
  snapshotUsed: SnapshotUsed | null;
  providers: ProviderConversionStat[];
  overall: ProviderConversionStat;
  patientRows: PatientConversionRow[];
}

/**
 * invoiceNo -> patientId, built once from the full sales history. The Package Benefits Detail
 * export carries no Guest Code, only Guest Name and the original package-purchase Invoice No -
 * every invoice maps to exactly one patient in the sales data, so this resolves it precisely
 * (more reliable than matching by name, which can collide across patients who share a name).
 */
export function buildInvoiceToPatientMap(allRecords: SaleRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of allRecords) {
    if (!map.has(r.invoiceNo)) map.set(r.invoiceNo, r.patientId);
  }
  return map;
}

function buildPatientsWithBalance(
  benefits: PackageBenefitRecord[],
  invoiceToPatient: Map<string, string>,
): Set<string> {
  const set = new Set<string>();
  for (const b of benefits) {
    if (b.packageStatus !== 'Active' || b.balanceQty <= 0) continue;
    const patientId = invoiceToPatient.get(b.invoiceNo);
    if (patientId) set.add(patientId);
  }
  return set;
}

function emptyProviderStat(staff: string): ProviderConversionStat {
  return {
    staff,
    newUnconverted: 0,
    newConverted: 0,
    repeatUnconverted: 0,
    repeatConverted: 0,
    followUp: 0,
    followUpByReason: { yb111: 0, packageRedemption: 0, packageBalance: 0 },
    total: 0,
    conversionRate: null,
    revenue: 0,
    revenueAdjustment: 0,
  };
}

function finalizeStat(stat: ProviderConversionStat): ProviderConversionStat {
  stat.total = stat.newUnconverted + stat.newConverted + stat.repeatUnconverted + stat.repeatConverted + stat.followUp;
  const numerator = stat.newConverted + stat.repeatConverted;
  const denominator = stat.newConverted + stat.newUnconverted + stat.repeatUnconverted + stat.repeatConverted;
  stat.conversionRate = denominator > 0 ? (numerator / denominator) * 100 : null;
  return stat;
}

/** One classification per (patient, canonical provider, day) - a patient seeing two providers the same day counts once for each; a nurse's lines are folded into her doctor's bucket via `providerGroups`. */
export function computeDailyConversion(
  records: SaleRecord[],
  patients: Map<string, PatientVisitSummary>,
  date: string,
  invoiceToPatient: Map<string, string>,
  packageBenefitsByDate: Map<string, PackageBenefitRecord[]>,
  providerGroups: ProviderGroup[] = [],
  revenueAdjustments: RevenueAdjustment[] = [],
  providerAssignmentOverrides: ProviderAssignmentOverride[] = [],
): DailyConversionSummary {
  const dayRecords = records.filter((r) => r.date === date);
  const resolvedSnapshot = resolveSnapshotForDate(packageBenefitsByDate, date);
  const patientsWithBalance = resolvedSnapshot ? buildPatientsWithBalance(resolvedSnapshot.records, invoiceToPatient) : null;

  // Keyed by patientId + staff, but patientId/staff are carried in the value (not parsed back
  // out of the key string) since provider names routinely contain spaces themselves.
  const groups = new Map<string, { patientId: string; staff: string; lines: SaleRecord[] }>();
  for (const r of dayRecords) {
    const staff = resolveProvider(r.staff, r.date, providerGroups, providerAssignmentOverrides);
    const key = `${r.patientId} ${staff}`;
    if (!groups.has(key)) groups.set(key, { patientId: r.patientId, staff, lines: [] });
    groups.get(key)!.lines.push(r);
  }

  const patientRows: PatientConversionRow[] = [];
  const providerMap = new Map<string, ProviderConversionStat>();

  for (const { patientId, staff, lines } of groups.values()) {
    const revenue = lines.reduce((sum, r) => sum + r.amount, 0);
    const hasPackageRedemption = lines.some((r) => !!r.packageName);
    const isYB111 = lines.some(hasFlaggedNote);
    const summary = patients.get(patientId);
    const isFirstVisit = !!summary && summary.firstVisit === date;

    let category: ConversionCategory;
    let followUpReason: FollowUpReason | null = null;

    if (isYB111) {
      category = 'followUp';
      followUpReason = 'yb111';
    } else if (isFirstVisit) {
      category = revenue > 0 ? 'newConverted' : 'newUnconverted';
    } else if (revenue > 0) {
      category = 'repeatConverted';
    } else if (hasPackageRedemption) {
      category = 'followUp';
      followUpReason = 'packageRedemption';
    } else if (patientsWithBalance?.has(patientId)) {
      category = 'followUp';
      followUpReason = 'packageBalance';
    } else {
      category = 'repeatUnconverted';
    }

    patientRows.push({
      patientId,
      patientName: lines[0].patientName,
      staff,
      date,
      revenue,
      category,
      followUpReason,
      services: [...new Set(lines.map((r) => r.serviceName))],
      hasPackageRedemption,
      isYB111,
      isFirstVisit,
    });

    if (!providerMap.has(staff)) providerMap.set(staff, emptyProviderStat(staff));
    const stat = providerMap.get(staff)!;
    stat.revenue += revenue;
    if (category === 'newUnconverted') stat.newUnconverted++;
    else if (category === 'newConverted') stat.newConverted++;
    else if (category === 'repeatUnconverted') stat.repeatUnconverted++;
    else if (category === 'repeatConverted') stat.repeatConverted++;
    else {
      stat.followUp++;
      stat.followUpByReason[followUpReason!]++;
    }
  }

  // Revenue Adjustments are a manual, transparent correction layered on top of the computed
  // totals - they move a dollar amount between two providers' Revenue figures for this date
  // only, and never change any patient's underlying conversion category/counts.
  for (const adj of revenueAdjustments) {
    if (adj.date !== date || adj.amount === 0) continue;
    const fromName = resolveProvider(adj.fromProvider, adj.date, providerGroups, providerAssignmentOverrides);
    const toName = resolveProvider(adj.toProvider, adj.date, providerGroups, providerAssignmentOverrides);
    if (!providerMap.has(fromName)) providerMap.set(fromName, emptyProviderStat(fromName));
    if (!providerMap.has(toName)) providerMap.set(toName, emptyProviderStat(toName));
    const fromStat = providerMap.get(fromName)!;
    const toStat = providerMap.get(toName)!;
    fromStat.revenue -= adj.amount;
    fromStat.revenueAdjustment -= adj.amount;
    toStat.revenue += adj.amount;
    toStat.revenueAdjustment += adj.amount;
  }

  const providers = [...providerMap.values()].map(finalizeStat).sort((a, b) => b.total - a.total);

  const overall = emptyProviderStat('All Providers');
  for (const p of providers) {
    overall.newUnconverted += p.newUnconverted;
    overall.newConverted += p.newConverted;
    overall.repeatUnconverted += p.repeatUnconverted;
    overall.repeatConverted += p.repeatConverted;
    overall.followUp += p.followUp;
    overall.revenue += p.revenue;
    (Object.keys(overall.followUpByReason) as FollowUpReason[]).forEach((reason) => {
      overall.followUpByReason[reason] += p.followUpByReason[reason];
    });
  }
  finalizeStat(overall);

  return {
    date,
    snapshotUsed: resolvedSnapshot?.used ?? null,
    providers,
    overall,
    patientRows: patientRows.sort((a, b) => a.staff.localeCompare(b.staff) || a.patientName.localeCompare(b.patientName)),
  };
}

export interface ConversionTrendPoint {
  date: string;
  conversionRate: number | null;
  total: number;
}

export function computeConversionTrend(
  records: SaleRecord[],
  patients: Map<string, PatientVisitSummary>,
  invoiceToPatient: Map<string, string>,
  packageBenefitsByDate: Map<string, PackageBenefitRecord[]>,
  days: string[],
  providerGroups: ProviderGroup[] = [],
  revenueAdjustments: RevenueAdjustment[] = [],
  providerAssignmentOverrides: ProviderAssignmentOverride[] = [],
): ConversionTrendPoint[] {
  return days.map((date) => {
    const summary = computeDailyConversion(
      records,
      patients,
      date,
      invoiceToPatient,
      packageBenefitsByDate,
      providerGroups,
      revenueAdjustments,
      providerAssignmentOverrides,
    );
    return { date, conversionRate: summary.overall.conversionRate, total: summary.overall.total };
  });
}

export function enumerateDates(range: DateRange): string[] {
  const days: string[] = [];
  let d = new Date(`${range.start}T00:00:00`);
  const end = new Date(`${range.end}T00:00:00`);
  while (d <= end) {
    days.push(toISODate(d));
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return days;
}

export interface RangeConversionSummary {
  range: DateRange;
  /** Days whose own exact-dated snapshot was used. */
  daysWithExactSnapshot: number;
  /** Days that had no snapshot of their own but used a nearby one (within SNAPSHOT_STALENESS_CAP_DAYS) as an estimate. */
  daysWithFallbackSnapshot: number;
  totalDays: number;
  /** Only meaningful for a single-day summary; always null for a multi-day range. */
  snapshotUsed: null;
  providers: ProviderConversionStat[];
  overall: ProviderConversionStat;
  patientRows: PatientConversionRow[];
}

/** Same classification as computeDailyConversion, aggregated across every day in the range - each day is still classified on its own terms (per the "for that particular day" logic), then summed per provider. */
export function computeRangeConversion(
  records: SaleRecord[],
  patients: Map<string, PatientVisitSummary>,
  range: DateRange,
  invoiceToPatient: Map<string, string>,
  packageBenefitsByDate: Map<string, PackageBenefitRecord[]>,
  providerGroups: ProviderGroup[] = [],
  revenueAdjustments: RevenueAdjustment[] = [],
  providerAssignmentOverrides: ProviderAssignmentOverride[] = [],
): RangeConversionSummary {
  const days = enumerateDates(range);
  const providerMap = new Map<string, ProviderConversionStat>();
  const patientRows: PatientConversionRow[] = [];
  let daysWithExactSnapshot = 0;
  let daysWithFallbackSnapshot = 0;

  for (const date of days) {
    const daily = computeDailyConversion(
      records,
      patients,
      date,
      invoiceToPatient,
      packageBenefitsByDate,
      providerGroups,
      revenueAdjustments,
      providerAssignmentOverrides,
    );
    if (daily.snapshotUsed) {
      if (daily.snapshotUsed.daysAway === 0) daysWithExactSnapshot++;
      else daysWithFallbackSnapshot++;
    }
    patientRows.push(...daily.patientRows);

    for (const p of daily.providers) {
      if (!providerMap.has(p.staff)) providerMap.set(p.staff, emptyProviderStat(p.staff));
      const agg = providerMap.get(p.staff)!;
      agg.newUnconverted += p.newUnconverted;
      agg.newConverted += p.newConverted;
      agg.repeatUnconverted += p.repeatUnconverted;
      agg.repeatConverted += p.repeatConverted;
      agg.followUp += p.followUp;
      agg.revenue += p.revenue;
      agg.revenueAdjustment += p.revenueAdjustment;
      (Object.keys(agg.followUpByReason) as FollowUpReason[]).forEach((reason) => {
        agg.followUpByReason[reason] += p.followUpByReason[reason];
      });
    }
  }

  const providers = [...providerMap.values()].map(finalizeStat).sort((a, b) => b.total - a.total);

  const overall = emptyProviderStat('All Providers');
  for (const p of providers) {
    overall.newUnconverted += p.newUnconverted;
    overall.newConverted += p.newConverted;
    overall.repeatUnconverted += p.repeatUnconverted;
    overall.repeatConverted += p.repeatConverted;
    overall.followUp += p.followUp;
    overall.revenue += p.revenue;
    overall.revenueAdjustment += p.revenueAdjustment;
    (Object.keys(overall.followUpByReason) as FollowUpReason[]).forEach((reason) => {
      overall.followUpByReason[reason] += p.followUpByReason[reason];
    });
  }
  finalizeStat(overall);

  return {
    range,
    daysWithExactSnapshot,
    daysWithFallbackSnapshot,
    totalDays: days.length,
    snapshotUsed: null,
    providers,
    overall,
    patientRows: patientRows.sort((a, b) => a.date.localeCompare(b.date) || a.staff.localeCompare(b.staff) || a.patientName.localeCompare(b.patientName)),
  };
}
