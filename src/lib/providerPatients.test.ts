import { describe, expect, it } from 'vitest';
import { computeProviderPatients } from './providerHandover';
import { makeSale } from '../test/fixtures';
import type { ProviderAssignmentOverride, ProviderGroup } from './conversionMetrics';

const FROM = '2026-06-01';
const AS_OF = '2026-07-31';

const visit = (patientId: string, date: string, staff: string, amount = 100) =>
  makeSale({ patientId, patientName: `Patient ${patientId}`, date, staff, amount });

const run = (records: Parameters<typeof computeProviderPatients>[0], extra = {}) =>
  computeProviderPatients(records, { provider: 'Fatima', fromDate: FROM, asOfISO: AS_OF, ...extra });

describe('computeProviderPatients', () => {
  it('separates a patient who came back from one who was seen once and vanished', () => {
    // The gap the handover view leaves: it counts a patient as kept the moment they appear once,
    // so a single visit followed by silence looks like an established relationship.
    const records = [
      visit('repeat', '2026-06-05', 'Fatima'), visit('repeat', '2026-07-05', 'Fatima'),
      visit('once', '2026-06-06', 'Fatima'),
    ];
    const s = run(records);
    expect(s.repeat.patients).toBe(1);
    expect(s.onceThenQuiet.patients).toBe(1);
    expect(s.repeatRate).toBe(50);
  });

  it('splits a single visit by whether they went to a colleague or disappeared', () => {
    const records = [
      visit('moved', '2026-06-06', 'Fatima'), visit('moved', '2026-07-01', 'Dr Sara'),
      visit('quiet', '2026-06-07', 'Fatima'),
    ];
    const s = run(records);
    expect(s.onceThenElsewhere.patients).toBe(1);
    expect(s.onceThenQuiet.patients).toBe(1);
    expect(s.patients.find((p) => p.patientId === 'moved')?.seenAfterElsewhere).toEqual(['Dr Sara']);
  });

  it('does not treat a later visit with the same provider as going elsewhere', () => {
    const records = [visit('p', '2026-06-05', 'Fatima'), visit('p', '2026-07-05', 'Fatima')];
    expect(run(records).patients[0].seenAfterElsewhere).toEqual([]);
  });

  it('tags an inherited patient as such', () => {
    const records = [visit('p', '2026-06-05', 'Fatima')];
    const s = run(records, { inheritedIds: new Set(['p']) });
    expect(s.patients[0].origin).toBe('inherited');
    expect(s.byOrigin.inherited.patients).toBe(1);
  });

  it('tags a patient whose first ever visit was with this provider as new to the clinic', () => {
    const records = [visit('p', '2026-06-05', 'Fatima')];
    expect(run(records).patients[0].origin).toBe('newToClinic');
  });

  it('tags a patient who had seen the clinic before as coming from elsewhere', () => {
    // Seen by another provider first, and not part of the inherited book.
    const records = [visit('p', '2026-01-05', 'Dr Sara'), visit('p', '2026-06-05', 'Fatima')];
    expect(run(records).patients[0].origin).toBe('fromElsewhere');
  });

  it('ignores visits before the provider took over', () => {
    const records = [visit('p', '2026-05-01', 'Fatima'), visit('p', '2026-06-05', 'Fatima')];
    const s = run(records);
    expect(s.patients[0].visitsWithProvider).toBe(1);
    expect(s.patients[0].firstVisitWithProvider).toBe('2026-06-05');
  });

  it('counts distinct visit days rather than line items', () => {
    const records = [visit('p', '2026-06-05', 'Fatima'), visit('p', '2026-06-05', 'Fatima')];
    const s = run(records);
    expect(s.patients[0].visitsWithProvider).toBe(1);
    expect(s.onceThenQuiet.patients).toBe(1);
  });

  it('counts package sessions consumed in the value, not just cash', () => {
    const records = [
      makeSale({ patientId: 'p', date: '2026-06-05', staff: 'Fatima', amount: 0, redeemedAmount: 400, packageName: 'Pkg' }),
    ];
    expect(run(records).total.value).toBe(400);
  });

  it('follows an assisting nurse to the doctor she assists', () => {
    const groups: ProviderGroup[] = [{ id: 'g1', canonicalName: 'Fatima', aliases: ['Reni'] }];
    const overrides: ProviderAssignmentOverride[] = [];
    const records = [visit('p', '2026-06-05', 'Reni'), visit('p', '2026-07-05', 'Fatima')];
    const s = computeProviderPatients(records, { provider: 'Fatima', fromDate: FROM, asOfISO: AS_OF, providerGroups: groups, overrides });
    expect(s.repeat.patients).toBe(1);
    expect(s.patients[0].visitsWithProvider).toBe(2);
  });

  it('leads with the patients seen once and gone, largest first', () => {
    const records = [
      visit('kept', '2026-06-01', 'Fatima', 900), visit('kept', '2026-07-01', 'Fatima'),
      visit('quietSmall', '2026-06-02', 'Fatima', 100),
      visit('quietBig', '2026-06-03', 'Fatima', 500),
    ];
    expect(run(records).patients.map((p) => p.patientId)).toEqual(['quietBig', 'quietSmall', 'kept']);
  });

  it('reports nothing rather than dividing by zero when the provider saw nobody', () => {
    const s = run([visit('p', '2026-06-05', 'Dr Sara')]);
    expect(s.total.patients).toBe(0);
    expect(s.repeatRate).toBeNull();
  });

  it('measures days away from the last visit anywhere, not just with this provider', () => {
    const records = [visit('p', '2026-06-05', 'Fatima'), visit('p', '2026-07-21', 'Dr Sara')];
    expect(run(records).patients[0].daysSinceLastVisit).toBe(10);
  });
});
