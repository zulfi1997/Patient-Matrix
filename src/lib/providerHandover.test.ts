import { describe, expect, it } from 'vitest';
import { computeProviderHandover, listProviders } from './providerHandover';
import { makeSale } from '../test/fixtures';
import type { ProviderAssignmentOverride, ProviderGroup } from './conversionMetrics';

const HANDOVER = '2026-03-31';
const AS_OF = '2026-07-31';

const visit = (patientId: string, date: string, staff: string, amount = 100) =>
  makeSale({ patientId, patientName: `Patient ${patientId}`, date, staff, amount });

const run = (records: Parameters<typeof computeProviderHandover>[0], extra: Partial<Parameters<typeof computeProviderHandover>[1]> = {}) =>
  computeProviderHandover(records, { outgoing: 'Obada', incoming: 'Fatima', handoverDate: HANDOVER, asOfISO: AS_OF, ...extra });

describe('computeProviderHandover', () => {
  it('splits the inherited book into kept, redistributed, and gone', () => {
    const records = [
      // Kept: saw Obada, then came back to Fatima.
      visit('keep', '2026-02-10', 'Obada'),
      visit('keep', '2026-05-02', 'Fatima'),
      // Redistributed: still visiting, but seeing someone else.
      visit('moved', '2026-02-11', 'Obada'),
      visit('moved', '2026-05-03', 'Dr Sara'),
      // Gone: no visit at all since the handover.
      visit('gone', '2026-02-12', 'Obada'),
    ];
    const s = run(records);
    expect(s.inherited.patients).toBe(3);
    expect(s.retained.patients).toBe(1);
    expect(s.movedToOther.patients).toBe(1);
    expect(s.notSeenSince.patients).toBe(1);
    expect(s.retentionRate).toBeCloseTo(33.333, 2);
  });

  it('counts a patient as kept even if they also saw other providers', () => {
    // Retained wins outright - seeing the successor at all is keeping them.
    const records = [visit('p', '2026-02-10', 'Obada'), visit('p', '2026-05-02', 'Dr Sara'), visit('p', '2026-06-02', 'Fatima')];
    const s = run(records);
    expect(s.retained.patients).toBe(1);
    expect(s.movedToOther.patients).toBe(0);
    expect(s.patients[0].seenBy).toEqual(['Dr Sara', 'Fatima']);
  });

  it('ignores patients the outgoing provider never saw', () => {
    const records = [visit('other', '2026-02-10', 'Dr Sara'), visit('other', '2026-05-10', 'Fatima')];
    expect(run(records).inherited.patients).toBe(0);
  });

  it('reports no retention rate when nothing was inherited', () => {
    expect(run([]).retentionRate).toBeNull();
  });

  it('measures the book by value, not just headcount', () => {
    // One large patient lost matters more than several small ones kept.
    const records = [
      visit('big', '2026-02-10', 'Obada', 5000),
      visit('small', '2026-02-11', 'Obada', 100),
      visit('small', '2026-05-11', 'Fatima', 100),
    ];
    const s = run(records);
    expect(s.inherited.valueWithOutgoing).toBe(5100);
    expect(s.notSeenSince.valueWithOutgoing).toBe(5000);
    expect(s.retained.valueWithOutgoing).toBe(100);
    expect(s.retentionRate).toBe(50); // headcount says half; value says almost all of it walked
  });

  it('reports what retained patients have since delivered', () => {
    const records = [visit('p', '2026-02-10', 'Obada', 100), visit('p', '2026-05-02', 'Fatima', 250)];
    expect(run(records).valueRecovered).toBe(250);
  });

  it('counts package value consumed, not just cash', () => {
    const records = [
      makeSale({ patientId: 'p', date: '2026-02-10', staff: 'Obada', amount: 0, redeemedAmount: 300, packageName: 'Pkg' }),
      visit('p', '2026-05-02', 'Fatima'),
    ];
    expect(run(records).inherited.valueWithOutgoing).toBe(300);
  });

  it('treats the handover date as belonging to the outgoing provider', () => {
    const records = [visit('p', HANDOVER, 'Obada'), visit('p', '2026-04-01', 'Fatima')];
    const s = run(records);
    expect(s.inherited.patients).toBe(1);
    expect(s.patients[0].lastVisitWithOutgoing).toBe(HANDOVER);
    expect(s.patients[0].firstVisitWithIncoming).toBe('2026-04-01');
  });

  it('limits the book to a lookback window when given one', () => {
    // A patient seen once long ago was never part of what changed hands.
    const records = [visit('stale', '2024-01-05', 'Obada'), visit('recent', '2026-03-01', 'Obada')];
    expect(run(records).inherited.patients).toBe(2);
    expect(run(records, { lookbackDays: 365 }).inherited.patients).toBe(1);
    expect(run(records, { lookbackDays: 365 }).bookFrom).toBe('2025-03-31');
  });

  it('counts distinct visit days, not line items', () => {
    const records = [
      visit('p', '2026-02-10', 'Obada'),
      visit('p', '2026-02-10', 'Obada'), // same day, second line
      visit('p', '2026-05-02', 'Fatima'),
      visit('p', '2026-05-02', 'Fatima'),
    ];
    const s = run(records);
    expect(s.patients[0].visitsWithOutgoing).toBe(1);
    expect(s.patients[0].visitsSinceHandover).toBe(1);
  });

  it('follows an assisting nurse to whichever doctor she assisted at the time', () => {
    // Without provider resolution the nurse looks like a separate provider, and the book is
    // understated on both sides of the handover.
    const groups: ProviderGroup[] = [{ id: 'g1', canonicalName: 'Fatima', aliases: ['Reni'] }];
    const overrides: ProviderAssignmentOverride[] = [
      { id: 'o1', staffName: 'Reni', canonicalName: 'Obada', startDate: '2024-01-01', endDate: HANDOVER, note: '' },
    ];
    const records = [
      visit('p', '2026-02-10', 'Reni'), // pre-handover -> counts as Obada's
      visit('p', '2026-05-02', 'Reni'), // post-handover -> counts as Fatima's
    ];
    const s = computeProviderHandover(records, {
      outgoing: 'Obada', incoming: 'Fatima', handoverDate: HANDOVER, asOfISO: AS_OF, providerGroups: groups, overrides,
    });
    expect(s.inherited.patients).toBe(1);
    expect(s.retained.patients).toBe(1);
  });

  it('leads with the biggest losses rather than the wins', () => {
    const records = [
      visit('kept', '2026-02-10', 'Obada', 900),
      visit('kept', '2026-05-10', 'Fatima'),
      visit('lostSmall', '2026-02-11', 'Obada', 100),
      visit('lostBig', '2026-02-12', 'Obada', 500),
    ];
    expect(run(records).patients.map((p) => p.patientId)).toEqual(['lostBig', 'lostSmall', 'kept']);
  });

  it('reports how long a lost patient has been away', () => {
    const s = run([visit('p', '2026-02-10', 'Obada')]);
    expect(s.patients[0].daysSinceLastVisit).toBe(171);
  });
});

describe('listProviders', () => {
  it('lists canonical names, folding aliases in', () => {
    const groups: ProviderGroup[] = [{ id: 'g1', canonicalName: 'Fatima', aliases: ['Reni'] }];
    const records = [visit('a', '2026-05-01', 'Reni'), visit('b', '2026-05-01', 'Obada'), visit('c', '2026-05-01', 'Fatima')];
    expect(listProviders(records, groups)).toEqual(['Fatima', 'Obada']);
  });

  it('labels lines with no staff recorded', () => {
    expect(listProviders([makeSale({ staff: null })])).toEqual(['Unassigned']);
  });
});
