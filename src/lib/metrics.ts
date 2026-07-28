import type { ItemType, SaleRecord } from '../types';
import { toISODate } from './format';
import { hasFlaggedNote } from './filters';

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
  /** Of retainedPatients, how many were new (first-ever visit) last month. */
  newPatientsRetained: number;
  /** Of retainedPatients, how many had already visited before last month. */
  returningPatientsRetained: number;
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
    let newPatientsRetained = 0;
    let returningPatientsRetained = 0;
    for (const id of prevActiveSet) {
      if (!activeSet.has(id)) continue;
      retainedPatients++;
      const s = patients.get(id);
      if (s && isInRange(s.firstVisit, prevRange)) {
        newPatientsRetained++;
      } else {
        returningPatientsRetained++;
      }
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
      newPatientsRetained,
      returningPatientsRetained,
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

export interface MonthPatientListEntry {
  patientId: string;
  patientName: string;
  type: 'New' | 'Repeat';
  firstVisitDate: string;
  visitsThisMonth: number;
  revenueThisMonth: number;
}

/** The individual patients behind one month's New/Repeat counts in computeMonthlyTrend, for a downloadable "who are they" list. */
export function computeMonthPatientList(
  records: SaleRecord[],
  patients: Map<string, PatientVisitSummary>,
  monthISO: string,
): MonthPatientListEntry[] {
  const monthStart = new Date(`${monthISO}T00:00:00`);
  const range: DateRange = {
    start: toISODate(monthStart),
    end: toISODate(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0)),
  };
  const monthRecords = records.filter((r) => isInRange(r.date, range));

  const byPatient = new Map<string, { visits: Set<string>; revenue: number }>();
  for (const r of monthRecords) {
    let agg = byPatient.get(r.patientId);
    if (!agg) {
      agg = { visits: new Set(), revenue: 0 };
      byPatient.set(r.patientId, agg);
    }
    agg.visits.add(r.date);
    agg.revenue += r.amount;
  }

  const result: MonthPatientListEntry[] = [];
  for (const [patientId, agg] of byPatient) {
    const s = patients.get(patientId);
    if (!s) continue;
    result.push({
      patientId,
      patientName: s.patientName,
      type: isInRange(s.firstVisit, range) ? 'New' : 'Repeat',
      firstVisitDate: s.firstVisit,
      visitsThisMonth: agg.visits.size,
      revenueThisMonth: agg.revenue,
    });
  }

  return result.sort((a, b) => (a.type !== b.type ? (a.type === 'New' ? -1 : 1) : b.revenueThisMonth - a.revenueThisMonth));
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

export interface ReturnedPatient extends PatientVisitSummary {
  /** Their last visit before the gap that follows - the day they "went quiet." */
  wentQuietOn: string;
  /** Length of that gap, in days. */
  gapDays: number;
  /** First visit after the gap - the day they came back. */
  returnedOn: string;
  daysSinceReturn: number;
  visitsSinceReturn: number;
  revenueSinceReturn: number;
  /** False if they've gone quiet again since returning (their overall lastVisit is stale once more). */
  currentlyActive: boolean;
}

/**
 * Patients who at some point went inactivityThresholdDays+ without a visit, then came back - the
 * flip side of computeAtRiskPatients ("who's currently gone quiet" vs "who used to be gone quiet
 * and returned"). For a patient with more than one such gap in their history, only the most
 * recent one is reported, since that's the return that's actually relevant today.
 */
export function computeReturnedPatients(
  records: SaleRecord[],
  patients: Map<string, PatientVisitSummary>,
  inactivityThresholdDays: number,
  asOfISO: string,
): ReturnedPatient[] {
  const recordsByPatient = new Map<string, SaleRecord[]>();
  for (const r of records) {
    if (!recordsByPatient.has(r.patientId)) recordsByPatient.set(r.patientId, []);
    recordsByPatient.get(r.patientId)!.push(r);
  }

  const result: ReturnedPatient[] = [];
  for (const [patientId, patientRecords] of recordsByPatient) {
    const summary = patients.get(patientId);
    if (!summary) continue;

    const dates = [...new Set(patientRecords.map((r) => r.date))].sort();
    if (dates.length < 2) continue;

    // Scan from the end for the most recent gap that met the threshold - that's the last time
    // this patient actually "stopped visiting" before whatever visits they've had since.
    let gapIndex = -1;
    for (let i = dates.length - 2; i >= 0; i--) {
      if (daysBetween(dates[i], dates[i + 1]) >= inactivityThresholdDays) {
        gapIndex = i;
        break;
      }
    }
    if (gapIndex === -1) continue;

    const wentQuietOn = dates[gapIndex];
    const returnedOn = dates[gapIndex + 1];
    let revenueSinceReturn = 0;
    for (const r of patientRecords) {
      if (r.date >= returnedOn) revenueSinceReturn += r.amount;
    }

    result.push({
      ...summary,
      wentQuietOn,
      gapDays: daysBetween(wentQuietOn, returnedOn),
      returnedOn,
      daysSinceReturn: daysBetween(returnedOn, asOfISO),
      visitsSinceReturn: dates.length - (gapIndex + 1),
      revenueSinceReturn,
      currentlyActive: daysBetween(summary.lastVisit, asOfISO) < inactivityThresholdDays,
    });
  }

  return result.sort((a, b) => b.returnedOn.localeCompare(a.returnedOn));
}

/** Line items from each patient's first-ever visit, for patients whose first visit falls inside range. */
function getNewPatientFirstVisitRecords(
  records: SaleRecord[],
  patients: Map<string, PatientVisitSummary>,
  range: DateRange,
): SaleRecord[] {
  return records.filter((r) => {
    const s = patients.get(r.patientId);
    return !!s && isInRange(s.firstVisit, range) && r.date === s.firstVisit;
  });
}

export interface NewPatientRevenueSummary {
  newPatientRevenue: number;
  returningPatientRevenue: number;
  totalRevenue: number;
  newPatients: number;
}

/** Revenue/new-patient split for an arbitrary period, mirroring computeKpis but focused on new vs returning revenue. */
export function computeNewPatientRevenueSummary(
  records: SaleRecord[],
  patients: Map<string, PatientVisitSummary>,
  range: DateRange,
): NewPatientRevenueSummary {
  const periodRecords = records.filter((r) => isInRange(r.date, range));
  let newPatientRevenue = 0;
  let returningPatientRevenue = 0;
  const newPatientIds = new Set<string>();

  for (const r of periodRecords) {
    const s = patients.get(r.patientId);
    if (s && isInRange(s.firstVisit, range)) {
      newPatientRevenue += r.amount;
      newPatientIds.add(r.patientId);
    } else {
      returningPatientRevenue += r.amount;
    }
  }

  return {
    newPatientRevenue,
    returningPatientRevenue,
    totalRevenue: newPatientRevenue + returningPatientRevenue,
    newPatients: newPatientIds.size,
  };
}

export interface NewPatientDetail {
  patientId: string;
  patientName: string;
  firstVisitDate: string;
  services: string[];
  revenue: number;
}

/** One row per new patient (first visit within range), with what they bought on that first visit. */
export function computeNewPatientDetails(
  records: SaleRecord[],
  patients: Map<string, PatientVisitSummary>,
  range: DateRange,
): NewPatientDetail[] {
  const firstVisitRecords = getNewPatientFirstVisitRecords(records, patients, range);

  const map = new Map<string, NewPatientDetail>();
  for (const r of firstVisitRecords) {
    let d = map.get(r.patientId);
    if (!d) {
      const s = patients.get(r.patientId)!;
      d = { patientId: r.patientId, patientName: s.patientName, firstVisitDate: s.firstVisit, services: [], revenue: 0 };
      map.set(r.patientId, d);
    }
    if (!d.services.includes(r.serviceName)) d.services.push(r.serviceName);
    d.revenue += r.amount;
  }
  return [...map.values()].sort((a, b) => b.firstVisitDate.localeCompare(a.firstVisitDate));
}

export interface NewPatientServiceStat {
  serviceName: string;
  /** Distinct new patients who bought this on their first visit. */
  patientCount: number;
  revenue: number;
}

/** Which services new patients buy on their first visit (within range), ranked by how many new patients bought each. */
export function computeNewPatientTopServices(
  records: SaleRecord[],
  patients: Map<string, PatientVisitSummary>,
  range: DateRange,
): NewPatientServiceStat[] {
  const firstVisitRecords = getNewPatientFirstVisitRecords(records, patients, range);

  const map = new Map<string, { patients: Set<string>; revenue: number }>();
  for (const r of firstVisitRecords) {
    let s = map.get(r.serviceName);
    if (!s) {
      s = { patients: new Set(), revenue: 0 };
      map.set(r.serviceName, s);
    }
    s.patients.add(r.patientId);
    s.revenue += r.amount;
  }
  return [...map.entries()]
    .map(([serviceName, v]) => ({ serviceName, patientCount: v.patients.size, revenue: v.revenue }))
    .sort((a, b) => b.patientCount - a.patientCount);
}

export interface FlaggedSummary {
  count: number;
  amount: number;
  distinctPatients: number;
  distinctStaff: number;
}

/** Summary of "YB111"-flagged line items within range. */
export function computeFlaggedSummary(records: SaleRecord[], range: DateRange): FlaggedSummary {
  const flagged = records.filter((r) => hasFlaggedNote(r) && isInRange(r.date, range));
  const patients = new Set(flagged.map((r) => r.patientId));
  const staff = new Set(flagged.map((r) => r.staff ?? 'Unknown'));
  return {
    count: flagged.length,
    amount: flagged.reduce((sum, r) => sum + r.amount, 0),
    distinctPatients: patients.size,
    distinctStaff: staff.size,
  };
}

export interface FlaggedTransaction {
  patientId: string;
  patientName: string;
  date: string;
  serviceName: string;
  itemType: ItemType;
  amount: number;
  staff: string | null;
  invoiceNo: string;
  notes: string;
}

/** Individual "YB111"-flagged line items within range, most recent first. */
export function computeFlaggedTransactions(records: SaleRecord[], range: DateRange): FlaggedTransaction[] {
  return records
    .filter((r) => hasFlaggedNote(r) && isInRange(r.date, range))
    .map((r) => ({
      patientId: r.patientId,
      patientName: r.patientName,
      date: r.date,
      serviceName: r.serviceName,
      itemType: r.itemType,
      amount: r.amount,
      staff: r.staff,
      invoiceNo: r.invoiceNo,
      notes: r.invoiceNotes ?? '',
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface FlaggedBreakdownStat {
  key: string;
  count: number;
  amount: number;
}

function computeFlaggedBreakdown(
  records: SaleRecord[],
  range: DateRange,
  keyFn: (r: SaleRecord) => string,
): FlaggedBreakdownStat[] {
  const map = new Map<string, FlaggedBreakdownStat>();
  for (const r of records) {
    if (!hasFlaggedNote(r) || !isInRange(r.date, range)) continue;
    const key = keyFn(r);
    let s = map.get(key);
    if (!s) {
      s = { key, count: 0, amount: 0 };
      map.set(key, s);
    }
    s.count += 1;
    s.amount += r.amount;
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function computeFlaggedByStaff(records: SaleRecord[], range: DateRange): FlaggedBreakdownStat[] {
  return computeFlaggedBreakdown(records, range, (r) => r.staff ?? 'Unknown');
}

export function computeFlaggedByService(records: SaleRecord[], range: DateRange): FlaggedBreakdownStat[] {
  return computeFlaggedBreakdown(records, range, (r) => r.serviceName);
}

export interface FlaggedMonthlyPoint {
  month: string;
  count: number;
  amount: number;
}

/** Monthly trend of flagged transaction count/value, over the last monthsBack months (independent of any period filter). */
export function computeFlaggedMonthlyTrend(records: SaleRecord[], monthsBack: number, asOfISO: string): FlaggedMonthlyPoint[] {
  const asOf = new Date(`${asOfISO}T00:00:00`);
  const points: FlaggedMonthlyPoint[] = [];

  for (let i = monthsBack - 1; i >= 0; i--) {
    const monthStart = new Date(asOf.getFullYear(), asOf.getMonth() - i, 1);
    const monthEnd = new Date(asOf.getFullYear(), asOf.getMonth() - i + 1, 0);
    const range: DateRange = { start: toISODate(monthStart), end: toISODate(monthEnd) };
    const flagged = records.filter((r) => hasFlaggedNote(r) && isInRange(r.date, range));
    points.push({
      month: range.start,
      count: flagged.length,
      amount: flagged.reduce((sum, r) => sum + r.amount, 0),
    });
  }

  return points;
}

export type AgingBucket = '0-15' | '16-30' | '31-60' | '60+';

const AGING_BUCKETS: AgingBucket[] = ['0-15', '16-30', '31-60', '60+'];

function agingBucketFor(ageDays: number): AgingBucket {
  if (ageDays <= 15) return '0-15';
  if (ageDays <= 30) return '16-30';
  if (ageDays <= 60) return '31-60';
  return '60+';
}

export interface InvoiceAgingRow {
  invoiceNo: string;
  patientId: string;
  patientName: string;
  date: string;
  services: string[];
  dueAmount: number;
  invoiceStatus: string;
  ageDays: number;
  agingBucket: AgingBucket;
}

/**
 * Invoice-wise outstanding balance and age (days since Sale Date, as of `asOfISO`), across ALL
 * sales data regardless of any period filter elsewhere on the dashboard - a balance doesn't stop
 * being owed just because the invoice's sale date falls outside whatever range is selected.
 */
export function computeInvoiceAging(records: SaleRecord[], asOfISO: string): InvoiceAgingRow[] {
  const map = new Map<string, InvoiceAgingRow>();
  for (const r of records) {
    if (r.dueAmount <= 0) continue;
    let inv = map.get(r.invoiceNo);
    if (!inv) {
      inv = {
        invoiceNo: r.invoiceNo,
        patientId: r.patientId,
        patientName: r.patientName,
        date: r.date,
        services: [],
        dueAmount: 0,
        invoiceStatus: r.invoiceStatus,
        ageDays: 0,
        agingBucket: '0-15',
      };
      map.set(r.invoiceNo, inv);
    }
    if (!inv.services.includes(r.serviceName)) inv.services.push(r.serviceName);
    inv.dueAmount += r.dueAmount;
    if (r.date > inv.date) inv.date = r.date;
  }

  const rows = [...map.values()];
  for (const inv of rows) {
    inv.ageDays = Math.max(0, daysBetween(inv.date, asOfISO));
    inv.agingBucket = agingBucketFor(inv.ageDays);
  }
  return rows.sort((a, b) => b.ageDays - a.ageDays);
}

export interface AgingBucketStat {
  bucket: AgingBucket;
  count: number;
  amount: number;
}

/** Fixed bucket order (0-15, 16-30, 31-60, 60+), zero-filled so an empty bucket still shows as 0 rather than disappearing. */
export function computeAgingBucketSummary(rows: InvoiceAgingRow[]): AgingBucketStat[] {
  const map = new Map<AgingBucket, AgingBucketStat>(AGING_BUCKETS.map((b) => [b, { bucket: b, count: 0, amount: 0 }]));
  for (const r of rows) {
    const s = map.get(r.agingBucket)!;
    s.count += 1;
    s.amount += r.dueAmount;
  }
  return AGING_BUCKETS.map((b) => map.get(b)!);
}

export interface FlaggedDueInvoice {
  invoiceNo: string;
  patientId: string;
  patientName: string;
  date: string;
  services: string[];
  dueAmount: number;
  invoiceStatus: string;
}

/** Invoices (with at least one "YB111"-flagged line) that still have an outstanding balance, within range. */
export function computeFlaggedDueInvoices(records: SaleRecord[], range: DateRange): FlaggedDueInvoice[] {
  const map = new Map<string, FlaggedDueInvoice>();
  for (const r of records) {
    if (!hasFlaggedNote(r) || !isInRange(r.date, range) || r.dueAmount <= 0) continue;
    let inv = map.get(r.invoiceNo);
    if (!inv) {
      inv = {
        invoiceNo: r.invoiceNo,
        patientId: r.patientId,
        patientName: r.patientName,
        date: r.date,
        services: [],
        dueAmount: 0,
        invoiceStatus: r.invoiceStatus,
      };
      map.set(r.invoiceNo, inv);
    }
    if (!inv.services.includes(r.serviceName)) inv.services.push(r.serviceName);
    inv.dueAmount += r.dueAmount;
    if (r.date > inv.date) inv.date = r.date;
  }
  return [...map.values()].sort((a, b) => b.dueAmount - a.dueAmount);
}
