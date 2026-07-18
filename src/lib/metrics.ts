import type { ItemType, SaleRecord } from '../types';
import { toISODate } from './format';

export interface DateRange {
  start: string; // ISO yyyy-mm-dd, inclusive
  end: string; // ISO yyyy-mm-dd, inclusive
}

export function isInRange(date: string, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function daysBetween(fromISO: string, toISOStr: string): number {
  const a = new Date(`${fromISO}T00:00:00`).getTime();
  const b = new Date(`${toISOStr}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Returns the [start,end] preceding `range` with the same number of days, used as the comparison cohort. */
export function previousPeriod(range: DateRange): DateRange {
  const lengthDays = daysBetween(range.start, range.end) + 1;
  const end = addDays(range.start, -1);
  const start = addDays(end, -(lengthDays - 1));
  return { start, end };
}

export interface PatientVisitSummary {
  patientId: string;
  patientName: string;
  firstVisit: string;
  lastVisit: string;
  lifetimeVisits: number; // distinct visit days
  lifetimeRevenue: number;
}

export function summarizePatients(records: SaleRecord[]): Map<string, PatientVisitSummary> {
  const map = new Map<string, PatientVisitSummary>();
  const visitDays = new Map<string, Set<string>>();

  for (const r of records) {
    let s = map.get(r.patientId);
    if (!s) {
      s = {
        patientId: r.patientId,
        patientName: r.patientName,
        firstVisit: r.date,
        lastVisit: r.date,
        lifetimeVisits: 0,
        lifetimeRevenue: 0,
      };
      map.set(r.patientId, s);
      visitDays.set(r.patientId, new Set());
    }
    if (r.date < s.firstVisit) s.firstVisit = r.date;
    if (r.date > s.lastVisit) s.lastVisit = r.date;
    s.lifetimeRevenue += r.amount;
    s.patientName = r.patientName || s.patientName;
    visitDays.get(r.patientId)!.add(r.date);
  }

  for (const [id, s] of map) {
    s.lifetimeVisits = visitDays.get(id)!.size;
  }
  return map;
}

export interface KpiResult {
  periodRevenue: number;
  periodRedeemedRevenue: number;
  periodTransactions: number;
  activePatients: number;
  newPatients: number;
  returningPatients: number;
  prevActivePatients: number;
  retainedPatients: number;
  retentionRate: number | null;
  turnoverRate: number | null;
  stoppedVisiting: number;
}

export function computeKpis(
  records: SaleRecord[],
  range: DateRange,
  patients: Map<string, PatientVisitSummary>,
  inactivityThresholdDays: number,
  asOfISO: string,
): KpiResult {
  const prevRange = previousPeriod(range);

  const periodRecords = records.filter((r) => isInRange(r.date, range));
  const periodRevenue = periodRecords.reduce((sum, r) => sum + r.amount, 0);
  const periodRedeemedRevenue = periodRecords.reduce((sum, r) => sum + r.redeemedAmount, 0);

  const activeSet = new Set(periodRecords.map((r) => r.patientId));
  const prevActiveSet = new Set(
    records.filter((r) => isInRange(r.date, prevRange)).map((r) => r.patientId),
  );

  let newPatients = 0;
  for (const id of activeSet) {
    const s = patients.get(id);
    if (s && isInRange(s.firstVisit, range)) newPatients++;
  }
  const returningPatients = activeSet.size - newPatients;

  let retained = 0;
  for (const id of prevActiveSet) {
    if (activeSet.has(id)) retained++;
  }
  const retentionRate = prevActiveSet.size > 0 ? (retained / prevActiveSet.size) * 100 : null;
  const turnoverRate = prevActiveSet.size > 0 ? ((prevActiveSet.size - retained) / prevActiveSet.size) * 100 : null;

  // Matches computeAtRiskPatients exactly (as-of-today, not period-scoped) so this
  // number always agrees with the "Patients Who Stopped Visiting" table below it.
  let stoppedVisiting = 0;
  for (const s of patients.values()) {
    if (daysBetween(s.lastVisit, asOfISO) >= inactivityThresholdDays) {
      stoppedVisiting++;
    }
  }

  return {
    periodRevenue,
    periodRedeemedRevenue,
    periodTransactions: periodRecords.length,
    activePatients: activeSet.size,
    newPatients,
    returningPatients,
    prevActivePatients: prevActiveSet.size,
    retainedPatients: retained,
    retentionRate,
    turnoverRate,
    stoppedVisiting,
  };
}

export interface MonthlyTrendPoint {
  month: string; // ISO of first day of month
  activePatients: number;
  newPatients: number;
  /** Active this month with at least one prior visit (before this month). */
  returningPatients: number;
  /** Of last month's active patients, how many also visited this month. */
  retainedPatients: number;
  prevMonthActivePatients: number;
  /** retainedPatients / prevMonthActivePatients, null if the prior month had no activity. */
  retentionRate: number | null;
  revenue: number;
  /** Revenue this month from patients whose first-ever visit was also this month. */
  newPatientRevenue: number;
  /** Revenue this month from patients who had already visited before this month. */
  returningPatientRevenue: number;
  transactions: number;
}

export function computeMonthlyTrend(
  records: SaleRecord[],
  patients: Map<string, PatientVisitSummary>,
  monthsBack: number,
  asOfISO: string,
): MonthlyTrendPoint[] {
  const asOf = new Date(`${asOfISO}T00:00:00`);
  const points: MonthlyTrendPoint[] = [];

  for (let i = monthsBack - 1; i >= 0; i--) {
    const monthStart = new Date(asOf.getFullYear(), asOf.getMonth() - i, 1);
    const monthEnd = new Date(asOf.getFullYear(), asOf.getMonth() - i + 1, 0);
    const range: DateRange = { start: toISODate(monthStart), end: toISODate(monthEnd) };

    const prevMonthStart = new Date(asOf.getFullYear(), asOf.getMonth() - i - 1, 1);
    const prevMonthEnd = new Date(asOf.getFullYear(), asOf.getMonth() - i, 0);
    const prevRange: DateRange = { start: toISODate(prevMonthStart), end: toISODate(prevMonthEnd) };

    const monthRecords = records.filter((r) => isInRange(r.date, range));
    const activeSet = new Set(monthRecords.map((r) => r.patientId));
    let newPatients = 0;
    for (const id of activeSet) {
      const s = patients.get(id);
      if (s && isInRange(s.firstVisit, range)) newPatients++;
    }

    // Computed against all records (not just the displayed window) so the earliest
    // displayed month still gets a correct prior-month comparison.
    const prevActiveSet = new Set(records.filter((r) => isInRange(r.date, prevRange)).map((r) => r.patientId));
    let retainedPatients = 0;
    for (const id of prevActiveSet) {
      if (activeSet.has(id)) retainedPatients++;
    }
    const retentionRate = prevActiveSet.size > 0 ? (retainedPatients / prevActiveSet.size) * 100 : null;

    let newPatientRevenue = 0;
    let returningPatientRevenue = 0;
    for (const r of monthRecords) {
      const s = patients.get(r.patientId);
      if (s && isInRange(s.firstVisit, range)) {
        newPatientRevenue += r.amount;
      } else {
        returningPatientRevenue += r.amount;
      }
    }

    points.push({
      month: range.start,
      activePatients: activeSet.size,
      newPatients,
      returningPatients: activeSet.size - newPatients,
      retainedPatients,
      prevMonthActivePatients: prevActiveSet.size,
      retentionRate,
      revenue: monthRecords.reduce((sum, r) => sum + r.amount, 0),
      newPatientRevenue,
      returningPatientRevenue,
      transactions: monthRecords.length,
    });
  }

  return points;
}

export interface ServiceStat {
  serviceKey: string;
  serviceName: string;
  subcategory: string;
  itemType: ItemType;
  count: number;
  qty: number;
  revenue: number;
}

export function computeServiceStats(
  records: SaleRecord[],
  range: DateRange,
  itemTypeFilter: ItemType | 'All',
): ServiceStat[] {
  const map = new Map<string, ServiceStat>();
  for (const r of records) {
    if (!isInRange(r.date, range)) continue;
    if (itemTypeFilter !== 'All' && r.itemType !== itemTypeFilter) continue;

    let s = map.get(r.serviceKey);
    if (!s) {
      s = {
        serviceKey: r.serviceKey,
        serviceName: r.serviceName,
        subcategory: r.subcategory,
        itemType: r.itemType,
        count: 0,
        qty: 0,
        revenue: 0,
      };
      map.set(r.serviceKey, s);
    }
    s.count += 1;
    s.qty += r.qty;
    s.revenue += r.amount;
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

export interface DormantServiceStat extends ServiceStat {
  lastSold: string;
  daysInactive: number;
}

/** All-time catalog of services filtered by type, flagged with how long since each last sold. */
export function computeDormantServices(
  records: SaleRecord[],
  asOfISO: string,
  inactivityThresholdDays: number,
  itemTypeFilter: ItemType | 'All',
): DormantServiceStat[] {
  interface Acc extends ServiceStat {
    lastSold: string;
  }
  const map = new Map<string, Acc>();

  for (const r of records) {
    if (itemTypeFilter !== 'All' && r.itemType !== itemTypeFilter) continue;
    let s = map.get(r.serviceKey);
    if (!s) {
      s = {
        serviceKey: r.serviceKey,
        serviceName: r.serviceName,
        subcategory: r.subcategory,
        itemType: r.itemType,
        count: 0,
        qty: 0,
        revenue: 0,
        lastSold: r.date,
      };
      map.set(r.serviceKey, s);
    }
    s.count += 1;
    s.qty += r.qty;
    s.revenue += r.amount;
    if (r.date > s.lastSold) s.lastSold = r.date;
  }

  return [...map.values()]
    .map((s) => ({ ...s, daysInactive: daysBetween(s.lastSold, asOfISO) }))
    .filter((s) => s.daysInactive >= inactivityThresholdDays)
    .sort((a, b) => b.daysInactive - a.daysInactive);
}

export interface RedeemedPackageStat {
  packageName: string;
  count: number;
  redeemedAmount: number;
}

/** Breakdown of package-redemption value by package, for the given period. */
export function computeRedeemedPackages(records: SaleRecord[], range: DateRange): RedeemedPackageStat[] {
  const map = new Map<string, RedeemedPackageStat>();
  for (const r of records) {
    if (!r.packageName || !isInRange(r.date, range)) continue;
    let s = map.get(r.packageName);
    if (!s) {
      s = { packageName: r.packageName, count: 0, redeemedAmount: 0 };
      map.set(r.packageName, s);
    }
    s.count += 1;
    s.redeemedAmount += r.redeemedAmount;
  }
  return [...map.values()].sort((a, b) => b.redeemedAmount - a.redeemedAmount);
}

export interface AtRiskPatient extends PatientVisitSummary {
  daysSinceLastVisit: number;
}

export function computeAtRiskPatients(
  patients: Map<string, PatientVisitSummary>,
  asOfISO: string,
  inactivityThresholdDays: number,
): AtRiskPatient[] {
  const result: AtRiskPatient[] = [];
  for (const s of patients.values()) {
    const daysSinceLastVisit = daysBetween(s.lastVisit, asOfISO);
    if (daysSinceLastVisit >= inactivityThresholdDays) {
      result.push({ ...s, daysSinceLastVisit });
    }
  }
  return result.sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit);
}
