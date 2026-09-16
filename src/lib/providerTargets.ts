import type { SaleRecord } from '../types';
import type { DateRange } from './metrics';
import { resolveProvider, type ProviderAssignmentOverride, type ProviderGroup, type RevenueAdjustment } from './conversionMetrics';
import { computeProviderRevenueByType } from './providerRevenueByType';
import { daysInMonth, lastDayOfMonth, monthKeyOf, workingDaysElapsed, workingDaysInMonth } from './months';

/**
 * Monthly revenue targets, one figure per provider per month.
 *
 * Judged against the same adjusted net revenue the Provider Analytics and Provider Conversion tabs
 * report, so a provider cannot be behind on one screen and ahead on another. That means Master
 * Control's Revenue Adjustments move a provider's actual here too, which is the point: an
 * adjustment exists precisely because the raw attribution was wrong.
 */
export interface ProviderTarget {
  /** `${provider}|${month}` - one target per provider per month, so re-entering replaces. */
  id: string;
  /** Canonical provider name. Resolved through Provider Groups, like every other name in the app. */
  provider: string;
  /** ISO yyyy-mm-01. */
  month: string;
  /** Target net revenue in OMR. */
  amount: number;
  note: string | null;
}

export type TargetStatus = 'met' | 'ahead' | 'behind' | 'noTarget';

export interface ProviderTargetProgress {
  provider: string;
  month: string;
  target: number;
  /** Adjusted net revenue for the whole calendar month, however much of it has elapsed. */
  actual: number;
  /** actual - target. Negative is the shortfall. */
  variance: number;
  /** Percentage of target reached, or null where no target was set. */
  achievedPct: number | null;

  /** Calendar days, for stating where in the month we are. */
  daysInMonth: number;
  /** Calendar days of the month covered by imported data. */
  daysElapsed: number;
  daysRemaining: number;

  /**
   * Working days, excluding the Friday-Saturday weekend. Every rate below is per working day: a
   * calendar-day rate asks for money on days the clinic is shut, and so understates what has to be
   * earned on the days it is open.
   */
  workingDaysInMonth: number;
  workingDaysElapsed: number;
  workingDaysRemaining: number;
  /** True once the month has fully elapsed, so the result is final rather than in progress. */
  complete: boolean;

  /** What should have been earned by now if the target were spread evenly across the working days. */
  paceTarget: number;
  /** Still to earn: target - actual, never negative. */
  remaining: number;
/** Per remaining working day - the headline "how much a day from here". Null with no working days left. */
  requiredPerDay: number | null;
  /** What the provider has averaged per elapsed working day. Null before the first working day. */
  actualPerDay: number | null;
  /** Where the month lands if the current working-day pace holds. Null before the first working day. */
  projected: number | null;
  status: TargetStatus;
}

export const TARGET_STATUS_LABELS: Record<TargetStatus, string> = {
  met: 'Met',
  ahead: 'Ahead of pace',
  behind: 'Behind',
  noTarget: 'No target set',
};

export function targetId(provider: string, month: string): string {
  return `${provider}|${monthKeyOf(month)}`;
}

/**
 * How far into the month the imported data reaches.
 *
 * Elapsed days come from the data's own as-of date rather than from the wall clock, because a
 * required-per-day figure computed against days the dashboard has no sales for would quietly
 * report every provider as behind.
 */
export function elapsedDays(month: string, asOf: string): number {
  const total = daysInMonth(month);
  if (asOf < month) return 0;
  if (asOf >= lastDayOfMonth(month)) return total;
  return Number(asOf.slice(8, 10));
}

function statusOf(target: number, actual: number, paceTarget: number): TargetStatus {
  if (target <= 0) return 'noTarget';
  if (actual >= target) return 'met';
  return actual >= paceTarget ? 'ahead' : 'behind';
}

/** Progress for one provider, given their actual for the month. Exported for direct use in tests. */
export function targetProgress(
  provider: string,
  month: string,
  target: number,
  actual: number,
  asOf: string,
): ProviderTargetProgress {
  const total = daysInMonth(month);
  const elapsed = elapsedDays(month, asOf);
  const remainingDays = total - elapsed;

  const workingTotal = workingDaysInMonth(month);
  const workingElapsed = workingDaysElapsed(month, asOf);
  const workingRemaining = workingTotal - workingElapsed;

  // Pace runs on working days too, or a provider measured on the Sunday after a weekend would look
  // behind for two days the clinic never opened.
  const paceTarget = workingTotal > 0 ? target * (workingElapsed / workingTotal) : 0;
  const remaining = Math.max(target - actual, 0);

  return {
    provider,
    month,
    target,
    actual,
    variance: actual - target,
    achievedPct: target > 0 ? (actual / target) * 100 : null,
    daysInMonth: total,
    daysElapsed: elapsed,
    daysRemaining: remainingDays,
    workingDaysInMonth: workingTotal,
    workingDaysElapsed: workingElapsed,
    workingDaysRemaining: workingRemaining,
    complete: remainingDays === 0,
    paceTarget,
    remaining,
    // Nothing to spread over once the working days are gone: the figure is a verdict, not a plan.
    // That can happen before the month ends - a target is not recoverable over a closed weekend.
    requiredPerDay: workingRemaining > 0 ? remaining / workingRemaining : null,
    actualPerDay: workingElapsed > 0 ? actual / workingElapsed : null,
    projected: workingElapsed > 0 ? (actual / workingElapsed) * workingTotal : null,
    status: statusOf(target, actual, paceTarget),
  };
}

/**
 * Target progress for every provider in one calendar month.
 *
 * Includes providers with revenue but no target, and providers with a target but no revenue. Both
 * are worth seeing: the first is a target somebody forgot to set, the second is a provider who has
 * not billed anything, and hiding either would make the table agree with itself by omission.
 */
export function computeProviderTargetProgress(
  records: SaleRecord[],
  targets: ProviderTarget[],
  month: string,
  asOf: string,
  providerGroups: ProviderGroup[],
  overrides: ProviderAssignmentOverride[],
  revenueAdjustments: RevenueAdjustment[] = [],
): ProviderTargetProgress[] {
  const monthKey = monthKeyOf(month);
  const range: DateRange = { start: monthKey, end: lastDayOfMonth(monthKey) };

  const actuals = new Map<string, number>();
  for (const row of computeProviderRevenueByType(records, range, providerGroups, overrides, revenueAdjustments)) {
    actuals.set(row.provider, row.netRevenue);
  }

  // A target may name an assisting nurse who is grouped under a doctor; resolving it the same way
  // the revenue was resolved keeps the two halves of the comparison on the same name.
  const targetFor = new Map<string, number>();
  for (const t of targets) {
    if (monthKeyOf(t.month) !== monthKey) continue;
    const provider = resolveProvider(t.provider, monthKey, providerGroups, overrides);
    targetFor.set(provider, (targetFor.get(provider) ?? 0) + t.amount);
  }

  const providers = new Set([...actuals.keys(), ...targetFor.keys()]);
  return [...providers]
    .map((provider) =>
      targetProgress(provider, monthKey, targetFor.get(provider) ?? 0, actuals.get(provider) ?? 0, asOf),
    )
    .sort((a, b) => b.target - a.target || b.actual - a.actual || a.provider.localeCompare(b.provider));
}

/**
 * The clinic-wide roll-up of the same month. Summed from the provider rows rather than recomputed,
 * so the total always equals what is printed above it.
 */
export function totalTargetProgress(rows: ProviderTargetProgress[], month: string, asOf: string): ProviderTargetProgress {
  let target = 0;
  let actual = 0;
  for (const row of rows) {
    target += row.target;
    actual += row.actual;
  }
  return targetProgress('All Providers', monthKeyOf(month), target, actual, asOf);
}
