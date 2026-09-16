import { describe, expect, it } from 'vitest';
import {
  computeProviderTargetProgress,
  elapsedDays,
  targetId,
  targetProgress,
  totalTargetProgress,
  type ProviderTarget,
} from './providerTargets';
import type { RevenueAdjustment } from './conversionMetrics';
import { makeSale } from '../test/fixtures';

const MONTH = '2026-09-01';

const target = (over: Partial<ProviderTarget> = {}): ProviderTarget => ({
  id: 't1', provider: 'Dr A', month: MONTH, amount: 30_000, note: null, ...over,
});

const find = (rows: ReturnType<typeof computeProviderTargetProgress>, provider: string) =>
  rows.find((r) => r.provider === provider)!;

describe('elapsedDays', () => {
  it('counts the day of the month the data reaches', () => {
    expect(elapsedDays(MONTH, '2026-09-15')).toBe(15);
  });

  it('is the whole month once the data runs past its end', () => {
    expect(elapsedDays(MONTH, '2026-09-30')).toBe(30);
    expect(elapsedDays(MONTH, '2026-11-02')).toBe(30);
  });

  it('is nothing before the month starts', () => {
    expect(elapsedDays(MONTH, '2026-08-31')).toBe(0);
  });

  it('uses the real length of the month', () => {
    expect(elapsedDays('2026-02-01', '2026-03-05')).toBe(28);
    expect(elapsedDays('2028-02-01', '2028-03-05')).toBe(29);
  });
});

describe('targetProgress', () => {
  it('states the gap and what it takes per day to close it', () => {
    // 30,000 target, 12,000 done by the 15th: 18,000 left over 15 remaining days.
    const p = targetProgress('Dr A', MONTH, 30_000, 12_000, '2026-09-15');
    expect(p).toMatchObject({ target: 30_000, actual: 12_000, variance: -18_000, remaining: 18_000 });
    expect(p.daysRemaining).toBe(15);
    expect(p.requiredPerDay).toBe(1_200);
    expect(p.achievedPct).toBe(40);
  });

  it('calls a provider behind when they trail the even pace, not merely the full target', () => {
    // Half the month gone, so 15,000 is the pace. Everyone is below the 30,000 target at this
    // point; only the one below pace is actually behind.
    expect(targetProgress('Dr A', MONTH, 30_000, 14_000, '2026-09-15').status).toBe('behind');
    expect(targetProgress('Dr A', MONTH, 30_000, 16_000, '2026-09-15').status).toBe('ahead');
  });

  it('calls it met the moment the target is reached, whatever the pace', () => {
    expect(targetProgress('Dr A', MONTH, 30_000, 30_000, '2026-09-15').status).toBe('met');
    expect(targetProgress('Dr A', MONTH, 30_000, 31_000, '2026-09-02').status).toBe('met');
  });

  it('gives a finished month a verdict rather than a plan', () => {
    const p = targetProgress('Dr A', MONTH, 30_000, 25_000, '2026-09-30');
    expect(p.complete).toBe(true);
    expect(p.daysRemaining).toBe(0);
    // No days left to spread the shortfall over, so a per-day figure would be a division by zero
    // dressed up as advice.
    expect(p.requiredPerDay).toBeNull();
    expect(p.status).toBe('behind');
  });

  it('asks for nothing per day once the target is already beaten', () => {
    const p = targetProgress('Dr A', MONTH, 30_000, 33_000, '2026-09-20');
    expect(p.remaining).toBe(0);
    expect(p.requiredPerDay).toBe(0);
    expect(p.variance).toBe(3_000);
  });

  it('projects the month end from the pace so far', () => {
    const p = targetProgress('Dr A', MONTH, 30_000, 12_000, '2026-09-15');
    expect(p.actualPerDay).toBe(800);
    expect(p.projected).toBe(24_000);
  });

  it('holds back a rate before the month has started', () => {
    const p = targetProgress('Dr A', MONTH, 30_000, 0, '2026-08-20');
    expect(p.daysElapsed).toBe(0);
    expect(p.actualPerDay).toBeNull();
    expect(p.projected).toBeNull();
    // The whole target still has the whole month to be earned in.
    expect(p.requiredPerDay).toBe(1_000);
  });

  it('says no target rather than reporting 100% against zero', () => {
    const p = targetProgress('Dr A', MONTH, 0, 5_000, '2026-09-15');
    expect(p.status).toBe('noTarget');
    expect(p.achievedPct).toBeNull();
  });
});

describe('computeProviderTargetProgress', () => {
  const sales = () => [
    makeSale({ staff: 'Dr A', date: '2026-09-05', amount: 12_000 }),
    makeSale({ staff: 'Dr B', date: '2026-09-06', amount: 4_000 }),
  ];

  const run = (
    rows = sales(),
    targets: ProviderTarget[] = [target()],
    asOf = '2026-09-15',
    groups = [],
    adjustments: RevenueAdjustment[] = [],
  ) => computeProviderTargetProgress(rows, targets, MONTH, asOf, groups, [], adjustments);

  it('measures actual against target for the whole calendar month', () => {
    expect(find(run(), 'Dr A')).toMatchObject({ target: 30_000, actual: 12_000, requiredPerDay: 1_200 });
  });

  it('ignores revenue from other months', () => {
    const rows = [
      makeSale({ staff: 'Dr A', date: '2026-09-05', amount: 12_000 }),
      makeSale({ staff: 'Dr A', date: '2026-08-31', amount: 99_000 }),
      makeSale({ staff: 'Dr A', date: '2026-10-01', amount: 99_000 }),
    ];
    expect(find(run(rows), 'Dr A').actual).toBe(12_000);
  });

  it('counts the whole month, not only the days that have elapsed', () => {
    // A sale dated after the as-of day can exist in a re-imported export; dropping it would make
    // actual disagree with the Revenue figure on every other screen.
    const rows = [
      makeSale({ staff: 'Dr A', date: '2026-09-05', amount: 12_000 }),
      makeSale({ staff: 'Dr A', date: '2026-09-28', amount: 1_000 }),
    ];
    expect(find(run(rows), 'Dr A').actual).toBe(13_000);
  });

  it('shows a provider who has a target but earned nothing', () => {
    const rows = [makeSale({ staff: 'Dr B', date: '2026-09-06', amount: 4_000 })];
    expect(find(run(rows), 'Dr A')).toMatchObject({ target: 30_000, actual: 0, status: 'behind' });
  });

  it('shows a provider who earned but has no target, rather than hiding them', () => {
    expect(find(run(), 'Dr B')).toMatchObject({ target: 0, actual: 4_000, status: 'noTarget' });
  });

  it('ignores a target set for a different month', () => {
    const rows = run(sales(), [target({ month: '2026-08-01' })]);
    expect(find(rows, 'Dr A').target).toBe(0);
  });

  it('folds an assisting nurse into the doctor on both sides of the comparison', () => {
    const rows = [
      makeSale({ staff: 'Nurse Reni', date: '2026-09-05', amount: 5_000 }),
      makeSale({ staff: 'Dr Obada', date: '2026-09-06', amount: 7_000 }),
    ];
    const groups = [{ id: 'g1', canonicalName: 'Dr Obada', aliases: ['Nurse Reni'] }];
    const result = computeProviderTargetProgress(
      rows, [target({ provider: 'Nurse Reni', amount: 30_000 })], MONTH, '2026-09-15', groups, [],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ provider: 'Dr Obada', target: 30_000, actual: 12_000 });
  });

  it('adds up two targets that resolve to the same provider', () => {
    const groups = [{ id: 'g1', canonicalName: 'Dr Obada', aliases: ['Nurse Reni'] }];
    const result = computeProviderTargetProgress(
      [makeSale({ staff: 'Dr Obada', date: '2026-09-05', amount: 1_000 })],
      [target({ provider: 'Dr Obada', amount: 20_000 }), target({ id: 't2', provider: 'Nurse Reni', amount: 5_000 })],
      MONTH, '2026-09-15', groups, [],
    );
    expect(result[0].target).toBe(25_000);
  });

  it('moves the actual when a Revenue Adjustment moves the revenue', () => {
    // An adjustment exists because the raw attribution was wrong, so a target measured against the
    // unadjusted figure would hold a provider to revenue the clinic has already said is not theirs.
    const adjustments: RevenueAdjustment[] = [
      { id: 'a1', date: '2026-09-10', fromProvider: 'Dr A', toProvider: 'Dr B', amount: 2_000, note: '' },
    ];
    const rows = run(sales(), [target()], '2026-09-15', [], adjustments);
    expect(find(rows, 'Dr A').actual).toBe(10_000);
    expect(find(rows, 'Dr B').actual).toBe(6_000);
  });

  it('ranks by target so the biggest commitments lead', () => {
    const targets = [target({ provider: 'Dr B', amount: 50_000 }), target({ id: 't2', amount: 30_000 })];
    expect(run(sales(), targets).map((r) => r.provider)).toEqual(['Dr B', 'Dr A']);
  });

  it('returns nothing when there is neither revenue nor a target', () => {
    expect(computeProviderTargetProgress([], [], MONTH, '2026-09-15', [], [])).toEqual([]);
  });
});

describe('totalTargetProgress', () => {
  it('sums the rows above it rather than recomputing', () => {
    const rows = computeProviderTargetProgress(
      [
        makeSale({ staff: 'Dr A', date: '2026-09-05', amount: 12_000 }),
        makeSale({ staff: 'Dr B', date: '2026-09-06', amount: 4_000 }),
      ],
      [target(), target({ id: 't2', provider: 'Dr B', amount: 10_000 })],
      MONTH, '2026-09-15', [], [],
    );
    const total = totalTargetProgress(rows, MONTH, '2026-09-15');
    expect(total).toMatchObject({ provider: 'All Providers', target: 40_000, actual: 16_000 });
    expect(total.target).toBe(rows.reduce((s, r) => s + r.target, 0));
    expect(total.actual).toBe(rows.reduce((s, r) => s + r.actual, 0));
    // 24,000 left across the 15 remaining days.
    expect(total.requiredPerDay).toBe(1_600);
  });
});

describe('targetId', () => {
  it('is one target per provider per month, so re-entering replaces', () => {
    expect(targetId('Dr A', '2026-09-17')).toBe('Dr A|2026-09-01');
    expect(targetId('Dr A', '2026-09-01')).toBe(targetId('Dr A', '2026-09-30'));
  });
});
