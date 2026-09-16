import type { SaleRecord } from '../types';
import type { PatientVisitSummary } from './metrics';
import { addMonths, lastDayOfMonth, monthKeyOf, monthsBetween } from './months';

/**
 * Cohort analysis: group patients by the month of their first-ever visit, then follow what each
 * group went on to spend in every month after.
 *
 * The question this answers is "what did May's new patients turn into by June", which none of the
 * period-scoped dashboards can: those report revenue earned in a period, split by whether the payer
 * happened to be new. A cohort instead follows one fixed set of people forward through time, which
 * is the only way to see whether an intake month was worth what it cost to acquire.
 */

/**
 * Which money a cell counts.
 *
 * `revenue` is new cash, the same basis as the dashboard Revenue figure. `deliveredValue` adds the
 * value of package sessions consumed. The distinction matters more here than anywhere else in the
 * app: a package sold in May and used up over the following four months books all of its cash in
 * May, so on a cash basis that cohort looks like it stopped spending immediately, while the clinic
 * is in fact still delivering to it. Delivered value spreads the same sale across the months the
 * work actually happened.
 */
export type CohortBasis = 'revenue' | 'deliveredValue';

export const COHORT_BASIS_LABELS: Record<CohortBasis, string> = {
  revenue: 'Cash Revenue',
  deliveredValue: 'Delivered Value',
};

export interface CohortCell {
  /** Calendar month this cell covers, ISO yyyy-mm-01. */
  month: string;
  /** Months since the cohort's acquisition month. 0 is the acquisition month itself. */
  monthIndex: number;
  /** New cash from this cohort in this month. Negative where refunds outweighed sales. */
  revenue: number;
  /** Value of previously-sold package sessions this cohort consumed in this month. */
  redeemed: number;
  /** revenue + redeemed. */
  deliveredValue: number;
  /** Distinct patients of this cohort who transacted in this month. */
  activePatients: number;
  /** True where the month runs past the last day of imported data, so the figure is still filling. */
  partial: boolean;
}

export interface PatientCohort {
  /** Month of first-ever visit, ISO yyyy-mm-01. */
  cohortMonth: string;
  /** Patients acquired that month. */
  patients: number;
  /** One cell per calendar month from the acquisition month to the end of the data, in order. */
  cells: CohortCell[];
  totalRevenue: number;
  totalRedeemed: number;
  totalDeliveredValue: number;
  /** Everything from the months after acquisition - what the cohort came back and spent. */
  repeatRevenue: number;
  repeatDeliveredValue: number;
  /** Distinct patients who transacted in any month after their acquisition month. */
  repeatPatients: number;
  /**
   * True only for the earliest month of imported data, where "first visit" cannot be trusted: a
   * patient of ten years' standing looks identical to a genuine first-timer, because there is no
   * earlier data to tell them apart. Every later cohort has at least one month of prior history
   * backing the claim.
   */
  censored: boolean;
}

export interface CohortAnalysis {
  cohorts: PatientCohort[];
  /** Every calendar month spanned by the data, ISO yyyy-mm-01, ascending. */
  months: string[];
  /** Highest month index reached by any cohort, so a table knows how many age columns to draw. */
  maxMonthIndex: number;
  /** Last day of imported data, which is what makes the final month partial. */
  asOf: string;
}

// Month arithmetic lives in ./months, shared with provider targets. Re-exported here because the
// cohort grid's callers and tests reach for it alongside the cohort types themselves.
export { addMonths, daysInMonth, lastDayOfMonth, monthKeyOf, monthsBetween } from './months';

/** The value a cell contributes under the chosen basis. */
export function cellValue(cell: CohortCell, basis: CohortBasis): number {
  return basis === 'revenue' ? cell.revenue : cell.deliveredValue;
}

/** A cohort's lifetime total under the chosen basis. */
export function cohortTotal(cohort: PatientCohort, basis: CohortBasis): number {
  return basis === 'revenue' ? cohort.totalRevenue : cohort.totalDeliveredValue;
}

/** What a cohort spent after its acquisition month, under the chosen basis. */
export function cohortRepeatTotal(cohort: PatientCohort, basis: CohortBasis): number {
  return basis === 'revenue' ? cohort.repeatRevenue : cohort.repeatDeliveredValue;
}

/**
 * Cohorts built from first-ever visit, with one cell per calendar month each cohort has lived
 * through. `patients` must come from `summarizePatients` over the same records, so that first
 * visits are judged against every row imported rather than whatever subset is on screen.
 */
export function computePatientCohorts(
  records: SaleRecord[],
  patients: Map<string, PatientVisitSummary>,
  asOf: string,
): CohortAnalysis {
  if (records.length === 0) return { cohorts: [], months: [], maxMonthIndex: 0, asOf };

  let firstMonth = monthKeyOf(records[0].date);
  let lastMonth = firstMonth;
  for (const r of records) {
    const m = monthKeyOf(r.date);
    if (m < firstMonth) firstMonth = m;
    if (m > lastMonth) lastMonth = m;
  }
  // Run to the as-of date rather than to the last month that happens to contain a sale. A cohort
  // that stopped spending in July has still lived through August, and that silence is the finding -
  // truncating the grid at the last transaction would hide it.
  const asOfMonth = monthKeyOf(asOf);
  if (asOfMonth > lastMonth) lastMonth = asOfMonth;

  interface Bucket {
    revenue: number;
    redeemed: number;
    active: Set<string>;
  }
  // cohortMonth -> calendarMonth -> bucket
  const grid = new Map<string, Map<string, Bucket>>();
  const cohortMembers = new Map<string, Set<string>>();

  for (const r of records) {
    const summary = patients.get(r.patientId);
    // A record whose patient is missing from the summary has no first visit to group by. That can
    // only happen if the two were built from different record sets, which is a caller error rather
    // than something to paper over with a guessed cohort.
    if (!summary) continue;

    const cohortMonth = monthKeyOf(summary.firstVisit);
    const recordMonth = monthKeyOf(r.date);

    let members = cohortMembers.get(cohortMonth);
    if (!members) {
      members = new Set();
      cohortMembers.set(cohortMonth, members);
    }
    members.add(r.patientId);

    let row = grid.get(cohortMonth);
    if (!row) {
      row = new Map();
      grid.set(cohortMonth, row);
    }
    let bucket = row.get(recordMonth);
    if (!bucket) {
      bucket = { revenue: 0, redeemed: 0, active: new Set() };
      row.set(recordMonth, bucket);
    }
    bucket.revenue += r.amount;
    bucket.redeemed += r.redeemedAmount;
    bucket.active.add(r.patientId);
  }

  const months: string[] = [];
  for (let m = firstMonth; m <= lastMonth; m = addMonths(m, 1)) months.push(m);

  const cohorts: PatientCohort[] = [];
  let maxMonthIndex = 0;

  for (const cohortMonth of [...grid.keys()].sort()) {
    const row = grid.get(cohortMonth)!;
    const cells: CohortCell[] = [];
    const repeatIds = new Set<string>();
    let totalRevenue = 0;
    let totalRedeemed = 0;
    let repeatRevenue = 0;
    let repeatRedeemed = 0;

    for (let m = cohortMonth; m <= lastMonth; m = addMonths(m, 1)) {
      const bucket = row.get(m);
      const monthIndex = monthsBetween(cohortMonth, m);
      const revenue = bucket?.revenue ?? 0;
      const redeemed = bucket?.redeemed ?? 0;

      cells.push({
        month: m,
        monthIndex,
        revenue,
        redeemed,
        deliveredValue: revenue + redeemed,
        activePatients: bucket?.active.size ?? 0,
        partial: lastDayOfMonth(m) > asOf,
      });

      totalRevenue += revenue;
      totalRedeemed += redeemed;
      if (monthIndex > 0) {
        repeatRevenue += revenue;
        repeatRedeemed += redeemed;
        if (bucket) for (const id of bucket.active) repeatIds.add(id);
      }
      if (monthIndex > maxMonthIndex) maxMonthIndex = monthIndex;
    }

    cohorts.push({
      cohortMonth,
      patients: cohortMembers.get(cohortMonth)?.size ?? 0,
      cells,
      totalRevenue,
      totalRedeemed,
      totalDeliveredValue: totalRevenue + totalRedeemed,
      repeatRevenue,
      repeatDeliveredValue: repeatRevenue + repeatRedeemed,
      repeatPatients: repeatIds.size,
      censored: cohortMonth === firstMonth,
    });
  }

  return { cohorts, months, maxMonthIndex, asOf };
}

/**
 * A cohort's running total up to and including each month - the form that answers "how much has
 * May's intake brought in by June", by reading the cell at index 1.
 */
export function cumulativeValues(cohort: PatientCohort, basis: CohortBasis): number[] {
  let running = 0;
  return cohort.cells.map((cell) => {
    running += cellValue(cell, basis);
    return running;
  });
}

export interface CohortAgeAverage {
  monthIndex: number;
  /** Cohorts old enough to have reached this age, and counted here. */
  cohorts: number;
  /** Their combined size, which is the denominator below. */
  patients: number;
  value: number;
  valuePerPatient: number | null;
}

/**
 * Average spend at each age across cohorts, which is the only fair way to compare them: May has had
 * four months to spend and August one, so lifetime totals rank cohorts by how long ago they were
 * acquired rather than by how good they were.
 *
 * A cohort counts towards an age only if it has actually lived through that month. Partial months
 * are excluded by default for the same reason - a cohort measured across half of September would
 * drag the age average down against cohorts measured over a whole month.
 */
export function averageByAge(
  cohorts: PatientCohort[],
  basis: CohortBasis,
  options: { includePartial?: boolean; includeCensored?: boolean } = {},
): CohortAgeAverage[] {
  const { includePartial = false, includeCensored = false } = options;
  const totals = new Map<number, { cohorts: number; patients: number; value: number }>();

  for (const cohort of cohorts) {
    if (cohort.censored && !includeCensored) continue;
    for (const cell of cohort.cells) {
      if (cell.partial && !includePartial) continue;
      let entry = totals.get(cell.monthIndex);
      if (!entry) {
        entry = { cohorts: 0, patients: 0, value: 0 };
        totals.set(cell.monthIndex, entry);
      }
      entry.cohorts += 1;
      entry.patients += cohort.patients;
      entry.value += cellValue(cell, basis);
    }
  }

  return [...totals.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([monthIndex, e]) => ({
      monthIndex,
      cohorts: e.cohorts,
      patients: e.patients,
      value: e.value,
      valuePerPatient: e.patients > 0 ? e.value / e.patients : null,
    }));
}

/**
 * What one cohort had contributed by the end of a given calendar month - the direct form of the
 * question "May's new patients, how much by June". Null where that month falls outside the
 * cohort's life, so a caller can say "not yet" rather than print a misleading zero.
 */
export function contributionThrough(
  cohort: PatientCohort,
  throughMonth: string,
  basis: CohortBasis,
): number | null {
  const index = monthsBetween(cohort.cohortMonth, monthKeyOf(throughMonth));
  if (index < 0 || index >= cohort.cells.length) return null;
  return cumulativeValues(cohort, basis)[index];
}
