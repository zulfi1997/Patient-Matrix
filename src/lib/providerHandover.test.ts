import { describe, expect, it } from 'vitest';
import { computeRoleHandover, listProviders, type RoleHolder } from './providerHandover';
import { makeSale } from '../test/fixtures';
import type { ProviderAssignmentOverride, ProviderGroup } from './conversionMetrics';

const AS_OF = '2026-07-31';

/** Obada until 01 Apr 2026, then Ahmed, then Fatima from 01 Jun 2026. */
const CHAIN: RoleHolder[] = [
  { provider: 'Obada', fromDate: '2024-01-01' },
  { provider: 'Ahmed', fromDate: '2026-04-01' },
  { provider: 'Fatima', fromDate: '2026-06-01' },
];

/** The simple two-holder case, which the timeline subsumes. */
const PAIR: RoleHolder[] = [
  { provider: 'Obada', fromDate: '2024-01-01' },
  { provider: 'Fatima', fromDate: '2026-04-01' },
];

const visit = (patientId: string, date: string, staff: string, amount = 100) =>
  makeSale({ patientId, patientName: `Patient ${patientId}`, date, staff, amount });

const run = (records: Parameters<typeof computeRoleHandover>[0], holders = CHAIN, extra = {}) =>
  computeRoleHandover(records, { holders, asOfISO: AS_OF, ...extra })!;

describe('computeRoleHandover', () => {
  it('needs at least two holders to describe a handover', () => {
    expect(computeRoleHandover([], { holders: [CHAIN[0]], asOfISO: AS_OF })).toBeNull();
  });

  it('separates a patient still with the role from one lost partway along the chain', () => {
    const records = [
      // Followed the role all the way through to the current holder.
      visit('stayed', '2026-02-01', 'Obada'), visit('stayed', '2026-04-15', 'Ahmed'), visit('stayed', '2026-06-15', 'Fatima'),
      // Stayed for Ahmed, then dropped off before Fatima took over.
      visit('midChain', '2026-02-02', 'Obada'), visit('midChain', '2026-04-16', 'Ahmed'),
    ];
    const s = run(records);
    expect(s.stillWithRole.patients).toBe(1);
    expect(s.lostMidChain.patients).toBe(1);
    expect(s.patients.find((p) => p.patientId === 'midChain')?.seenWithHolders).toEqual(['Ahmed']);
  });

  it('counts a patient who skipped the interim holder as still with the role', () => {
    // Only the current holder matters for "do we still have them".
    const records = [visit('p', '2026-02-01', 'Obada'), visit('p', '2026-06-15', 'Fatima')];
    const s = run(records);
    expect(s.stillWithRole.patients).toBe(1);
    expect(s.patients[0].seenWithHolders).toEqual(['Fatima']);
  });

  it('does not credit the role when a holder is seen outside their own tenure', () => {
    // Ahmed seeing a patient after Fatima took over is not the role retaining them.
    const records = [visit('p', '2026-02-01', 'Obada'), visit('p', '2026-06-15', 'Ahmed')];
    const s = run(records);
    expect(s.wentElsewhere.patients).toBe(1);
    expect(s.patients[0].otherProvidersSeen).toEqual(['Ahmed']);
  });

  it('distinguishes going to an unrelated provider from disappearing', () => {
    const records = [
      visit('elsewhere', '2026-02-01', 'Obada'), visit('elsewhere', '2026-05-01', 'Dr Sara'),
      visit('gone', '2026-02-02', 'Obada'),
    ];
    const s = run(records);
    expect(s.wentElsewhere.patients).toBe(1);
    expect(s.notSeenSince.patients).toBe(1);
  });

  it('shows where the book thinned, hop by hop', () => {
    const records = [
      visit('a', '2026-02-01', 'Obada'), visit('a', '2026-04-15', 'Ahmed'), visit('a', '2026-06-15', 'Fatima'),
      visit('b', '2026-02-02', 'Obada'), visit('b', '2026-04-16', 'Ahmed'),
      visit('c', '2026-02-03', 'Obada'),
    ];
    const stages = run(records).stages;
    expect(stages.map((s) => [s.provider, s.patients])).toEqual([['Obada', 3], ['Ahmed', 2], ['Fatima', 1]]);
    expect(stages[2].untilDate).toBeNull(); // the current holder's tenure is still open
  });

  it('measures the book by value as well as headcount', () => {
    const records = [
      visit('big', '2026-02-01', 'Obada', 5000),
      visit('small', '2026-02-02', 'Obada', 100), visit('small', '2026-06-15', 'Fatima', 100),
    ];
    const s = run(records);
    expect(s.inherited.valueWithOriginal).toBe(5100);
    expect(s.notSeenSince.valueWithOriginal).toBe(5000);
    expect(s.retentionRate).toBe(50); // half the patients, but only 2% of the value
  });

  it('counts package value consumed, not just cash', () => {
    const records = [
      makeSale({ patientId: 'p', date: '2026-02-01', staff: 'Obada', amount: 0, redeemedAmount: 300, packageName: 'Pkg' }),
      visit('p', '2026-06-15', 'Fatima'),
    ];
    expect(run(records).inherited.valueWithOriginal).toBe(300);
  });

  it('reports what retained patients have delivered since', () => {
    const records = [visit('p', '2026-02-01', 'Obada', 100), visit('p', '2026-06-15', 'Fatima', 250)];
    expect(run(records).valueRecovered).toBe(250);
  });

  it('treats the successor start date as the first day they hold the role', () => {
    const records = [visit('p', '2026-03-31', 'Obada'), visit('p', '2026-04-01', 'Ahmed')];
    const s = run(records);
    expect(s.inherited.patients).toBe(1);
    expect(s.patients[0].lastVisitWithOriginal).toBe('2026-03-31');
    expect(s.patients[0].seenWithHolders).toEqual(['Ahmed']);
  });

  it('excludes patients the original holder never saw', () => {
    expect(run([visit('x', '2026-02-01', 'Dr Sara'), visit('x', '2026-06-15', 'Fatima')]).inherited.patients).toBe(0);
  });

  it('limits the book to a lookback, so pre-existing churn is not charged to the handover', () => {
    // The screenshot case: a patient last seen long before the handover had already gone.
    const records = [visit('stale', '2025-01-05', 'Obada'), visit('active', '2026-03-01', 'Obada')];
    expect(run(records).inherited.patients).toBe(2);
    expect(run(records, CHAIN, { lookbackDays: 365 }).inherited.patients).toBe(1);
    expect(run(records, CHAIN, { lookbackDays: 365 }).bookFrom).toBe('2025-04-01');
  });

  it('counts distinct visit days, not line items', () => {
    const records = [
      visit('p', '2026-02-01', 'Obada'), visit('p', '2026-02-01', 'Obada'),
      visit('p', '2026-06-15', 'Fatima'), visit('p', '2026-06-15', 'Fatima'),
    ];
    const s = run(records);
    expect(s.patients[0].visitsWithOriginal).toBe(1);
    expect(s.patients[0].visitsSinceHandover).toBe(1);
  });

  it('follows an assisting nurse to whichever doctor she assisted at the time', () => {
    const groups: ProviderGroup[] = [{ id: 'g1', canonicalName: 'Fatima', aliases: ['Reni'] }];
    const overrides: ProviderAssignmentOverride[] = [
      { id: 'o1', staffName: 'Reni', canonicalName: 'Obada', startDate: '2024-01-01', endDate: '2026-03-31', note: '' },
    ];
    const records = [visit('p', '2026-02-01', 'Reni'), visit('p', '2026-06-15', 'Reni')];
    const s = computeRoleHandover(records, { holders: CHAIN, asOfISO: AS_OF, providerGroups: groups, overrides })!;
    expect(s.inherited.patients).toBe(1);
    expect(s.stillWithRole.patients).toBe(1);
  });

  it('leads with the biggest losses rather than the wins', () => {
    const records = [
      visit('kept', '2026-02-01', 'Obada', 900), visit('kept', '2026-06-15', 'Fatima'),
      visit('lostSmall', '2026-02-02', 'Obada', 100),
      visit('lostBig', '2026-02-03', 'Obada', 500),
    ];
    expect(run(records).patients.map((p) => p.patientId)).toEqual(['lostBig', 'lostSmall', 'kept']);
  });

  it('reports how long a lost patient has been away', () => {
    expect(run([visit('p', '2026-02-01', 'Obada')]).patients[0].daysSinceLastVisit).toBe(180);
  });

  it('handles the plain two-holder case with no interim holder', () => {
    const records = [
      visit('kept', '2026-02-01', 'Obada'), visit('kept', '2026-05-01', 'Fatima'),
      visit('gone', '2026-02-02', 'Obada'),
    ];
    const s = run(records, PAIR);
    expect(s.stillWithRole.patients).toBe(1);
    expect(s.lostMidChain.patients).toBe(0); // no middle to be lost in
    expect(s.notSeenSince.patients).toBe(1);
    expect(s.retentionRate).toBe(50);
  });

  it('sorts holders by date regardless of the order given', () => {
    const s = run([visit('p', '2026-02-01', 'Obada')], [CHAIN[2], CHAIN[0], CHAIN[1]]);
    expect(s.holders.map((h) => h.provider)).toEqual(['Obada', 'Ahmed', 'Fatima']);
    expect(s.handoverDate).toBe('2026-04-01');
  });
});

describe('listProviders', () => {
  it('lists canonical names, folding aliases in', () => {
    const groups: ProviderGroup[] = [{ id: 'g1', canonicalName: 'Fatima', aliases: ['Reni'] }];
    const records = [visit('a', '2026-05-01', 'Reni'), visit('b', '2026-05-01', 'Obada')];
    expect(listProviders(records, groups)).toEqual(['Fatima', 'Obada']);
  });

  it('labels lines with no staff recorded', () => {
    expect(listProviders([makeSale({ staff: null })])).toEqual(['Unassigned']);
  });
});
