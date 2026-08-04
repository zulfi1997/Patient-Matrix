import { describe, expect, it } from 'vitest';
import { computeRoleRevenueTrend, type RoleHolder } from './providerHandover';
import { makeSale } from '../test/fixtures';
import type { ProviderAssignmentOverride, ProviderGroup } from './conversionMetrics';

const AS_OF = '2026-07-31';
const CHAIN: RoleHolder[] = [
  { provider: 'Obada', fromDate: '2026-01-01' },
  { provider: 'Ahmed', fromDate: '2026-04-15' },
  { provider: 'Fatima', fromDate: '2026-06-01' },
];

const visit = (patientId: string, date: string, staff: string, amount = 100) =>
  makeSale({ patientId, patientName: `Patient ${patientId}`, date, staff, amount });

const run = (records: Parameters<typeof computeRoleRevenueTrend>[0], holders = CHAIN) =>
  computeRoleRevenueTrend(records, { holders, asOfISO: AS_OF })!;

const pointFor = (t: ReturnType<typeof run>, month: string) => t.points.find((p) => p.month === month)!;

describe('computeRoleRevenueTrend', () => {
  it('splits a handover month between both holders rather than crediting one', () => {
    // April contains the 15th, so it belongs to neither holder wholly.
    const records = [visit('a', '2026-04-10', 'Obada', 300), visit('b', '2026-04-20', 'Ahmed', 200)];
    const april = pointFor(run(records), '2026-04-01');
    expect(april.value).toBe(500);
    expect(april.byHolder).toEqual({ Obada: 300, Ahmed: 200 });
    expect(april.holders.sort()).toEqual(['Ahmed', 'Obada']);
  });

  it('emits a zero for a month the role earned nothing', () => {
    // Omitting it would let a chart draw a straight line over the dip.
    const records = [visit('a', '2026-01-10', 'Obada', 100), visit('b', '2026-03-10', 'Obada', 100)];
    const t = run(records);
    expect(t.points.map((p) => p.month)).toContain('2026-02-01');
    expect(pointFor(t, '2026-02-01').value).toBe(0);
  });

  it('runs the series through to the report date, not the last sale', () => {
    const t = run([visit('a', '2026-01-10', 'Obada', 100)]);
    expect(t.points[t.points.length - 1].month).toBe('2026-07-01');
  });

  it('ignores work by a provider outside the role', () => {
    const records = [visit('a', '2026-02-10', 'Obada', 100), visit('b', '2026-02-11', 'Dr Sara', 900)];
    expect(pointFor(run(records), '2026-02-01').value).toBe(100);
  });

  it('does not credit a holder for work outside their own tenure', () => {
    // Obada seeing someone after Ahmed took over is not the role's revenue under Obada.
    const records = [visit('a', '2026-05-10', 'Obada', 500)];
    const t = run(records);
    expect(t.points.every((p) => p.value === 0)).toBe(true);
  });

  it('separates cash from package sessions consumed', () => {
    const records = [
      visit('a', '2026-02-10', 'Obada', 100),
      makeSale({ patientId: 'b', date: '2026-02-11', staff: 'Obada', amount: 0, redeemedAmount: 250, packageName: 'Pkg' }),
    ];
    const feb = pointFor(run(records), '2026-02-01');
    expect(feb.value).toBe(350);
    expect(feb.revenue).toBe(100);
    expect(feb.redeemed).toBe(250);
  });

  it('counts distinct patients per month', () => {
    const records = [
      visit('a', '2026-02-10', 'Obada'), visit('a', '2026-02-20', 'Obada'), visit('b', '2026-02-21', 'Obada'),
    ];
    expect(pointFor(run(records), '2026-02-01').patients).toBe(2);
  });

  it('compares holders per month held, not by raw total', () => {
    // Obada: 2026-01-01 to 04-15, ~104 days. Fatima: 06-01 to 07-31, ~61 days.
    // Equal totals must not read as equal performance.
    const records = [visit('a', '2026-02-10', 'Obada', 1000), visit('b', '2026-06-10', 'Fatima', 1000)];
    const t = run(records);
    const obada = t.byHolder.find((h) => h.provider === 'Obada')!;
    const fatima = t.byHolder.find((h) => h.provider === 'Fatima')!;
    expect(obada.value).toBe(fatima.value);
    expect(fatima.valuePerMonth!).toBeGreaterThan(obada.valuePerMonth!);
  });

  it('measures the current holder up to the report date', () => {
    const t = run([visit('a', '2026-06-10', 'Fatima', 100)]);
    const fatima = t.byHolder.find((h) => h.provider === 'Fatima')!;
    expect(fatima.untilDate).toBeNull();
    expect(fatima.days).toBe(61); // 01 Jun to 31 Jul inclusive
  });

  it('starts the first holder at the role\'s first activity when their start is unset', () => {
    const holders: RoleHolder[] = [{ provider: 'Obada', fromDate: '0000-01-01' }, ...CHAIN.slice(1)];
    const t = run([visit('a', '2026-02-10', 'Obada', 100)], holders);
    expect(t.byHolder[0].fromDate).toBe('2026-02-10');
    expect(t.byHolder[0].valuePerMonth).toBeGreaterThan(0);
  });

  it('folds an assisting nurse into the doctor she assists', () => {
    const groups: ProviderGroup[] = [{ id: 'g1', canonicalName: 'Fatima', aliases: ['Reni'] }];
    const overrides: ProviderAssignmentOverride[] = [];
    const t = computeRoleRevenueTrend([visit('a', '2026-06-10', 'Reni', 100)], {
      holders: CHAIN, asOfISO: AS_OF, providerGroups: groups, overrides,
    })!;
    expect(t.byHolder.find((h) => h.provider === 'Fatima')!.value).toBe(100);
  });

  it('excludes anything after the report date', () => {
    const t = run([visit('a', '2026-06-10', 'Fatima', 100), visit('b', '2026-09-01', 'Fatima', 999)]);
    expect(t.byHolder.find((h) => h.provider === 'Fatima')!.value).toBe(100);
  });

  it('returns no points when the role has no activity at all', () => {
    const t = run([visit('a', '2026-02-10', 'Dr Sara', 100)]);
    expect(t.points).toEqual([]);
    expect(t.byHolder.every((h) => h.value === 0)).toBe(true);
  });
});
