import { describe, expect, it } from 'vitest';
import { computeKpis, computeNewPatientRevenueSummary, summarizePatients, type DateRange } from './metrics';
import { excludeFlaggedRecords, excludeZeroValueRecords } from './filters';
import { makeSale } from '../test/fixtures';
import type { SaleRecord } from '../types';

const JUNE: DateRange = { start: '2026-06-01', end: '2026-06-30' };

/**
 * How the app wires the Exclude toggles: the filter decides which lines are counted in the period,
 * while the patient history behind "first-ever visit" is always built from every row.
 *
 * The regression this guards against is the two being wired to the same filtered set. Excluding
 * complimentary visits then erased a patient's earlier free consultation as well as dropping it
 * from the period, so their first paid visit read as their first visit ever and a long-standing
 * patient was reported as newly acquired. In June that held New Patients at 127 when it should
 * have fallen to 115, and in the right data it could push the figure up rather than down.
 */
const newPatients = (rows: SaleRecord[], filter: (r: SaleRecord[]) => SaleRecord[]) =>
  computeKpis(filter(rows), JUNE, summarizePatients(rows), 60, '2026-06-30').newPatients;

const none = (r: SaleRecord[]) => r;

describe('Exclude zero-revenue visits, and who counts as new', () => {
  it('drops a patient whose only visit in the month was complimentary', () => {
    const rows = [makeSale({ patientId: 'P1', date: '2026-06-10', amount: 0, redeemedAmount: 0 })];
    expect(newPatients(rows, none)).toBe(1);
    expect(newPatients(rows, excludeZeroValueRecords)).toBe(0);
  });

  it('keeps a patient returning when their earlier visits were complimentary', () => {
    // First came in March for a free consultation, first paid in June. June is not an acquisition,
    // and excluding the March line from the revenue figures does not make it one.
    const rows = [
      makeSale({ patientId: 'P2', date: '2026-03-04', amount: 0, redeemedAmount: 0 }),
      makeSale({ patientId: 'P2', date: '2026-06-12', amount: 120 }),
    ];
    expect(newPatients(rows, none)).toBe(0);
    expect(newPatients(rows, excludeZeroValueRecords)).toBe(0);
  });

  it('can only lower the count, never raise it', () => {
    // The shape that made the old wiring absurd: one genuinely new complimentary patient leaves,
    // and two long-standing patients used to be promoted to new in exchange. Ticking a box
    // labelled "exclude" made the headline go up.
    const rows = [
      makeSale({ patientId: 'NEW', date: '2026-06-02', amount: 0, redeemedAmount: 0 }),
      makeSale({ patientId: 'OLD1', date: '2026-01-05', amount: 0, redeemedAmount: 0 }),
      makeSale({ patientId: 'OLD1', date: '2026-06-06', amount: 80 }),
      makeSale({ patientId: 'OLD2', date: '2026-02-05', amount: 0, redeemedAmount: 0 }),
      makeSale({ patientId: 'OLD2', date: '2026-06-07', amount: 90 }),
    ];
    expect(newPatients(rows, none)).toBe(1);
    expect(newPatients(rows, excludeZeroValueRecords)).toBe(0);
  });

  it('removes exactly the new patients who brought no revenue, and nobody else', () => {
    // The arithmetic the clinic expects of the toggle: 5 new patients, 2 of them complimentary
    // only, leaves 3. Nothing is reclassified in either direction.
    const rows = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeSale({ patientId: `PAID${i}`, date: '2026-06-05', amount: 100 })),
      ...Array.from({ length: 2 }, (_, i) =>
        makeSale({ patientId: `FREE${i}`, date: '2026-06-06', amount: 0, redeemedAmount: 0 })),
    ];
    expect(newPatients(rows, none)).toBe(5);
    expect(newPatients(rows, excludeZeroValueRecords)).toBe(3);
  });

  it('leaves a package redemption alone, since that visit was paid for earlier', () => {
    const rows = [
      makeSale({ patientId: 'P3', date: '2026-03-01', amount: 0, redeemedAmount: 100, packageName: 'Derma' }),
      makeSale({ patientId: 'P3', date: '2026-06-01', amount: 50 }),
    ];
    expect(newPatients(rows, none)).toBe(0);
    expect(newPatients(rows, excludeZeroValueRecords)).toBe(0);
  });
});

describe('Exclude YB111-flagged transactions, and who counts as new', () => {
  it('does not turn a long-standing patient into an acquisition either', () => {
    // Same wiring, same trap: the flagged filter must not rewrite history any more than the
    // zero-revenue one does.
    const rows = [
      makeSale({ patientId: 'P4', date: '2026-02-02', amount: 200, invoiceNotes: 'YB111 correction' }),
      makeSale({ patientId: 'P4', date: '2026-06-02', amount: 200 }),
    ];
    expect(newPatients(rows, none)).toBe(0);
    expect(newPatients(rows, excludeFlaggedRecords)).toBe(0);
  });
});

describe('patient history is read from every row', () => {
  it('reports the true first visit whatever the period filter removed', () => {
    const rows = [
      makeSale({ patientId: 'P5', date: '2026-03-04', amount: 0, redeemedAmount: 0 }),
      makeSale({ patientId: 'P5', date: '2026-06-12', amount: 120 }),
    ];
    expect(summarizePatients(rows).get('P5')!.firstVisit).toBe('2026-03-04');
    // Built from the filtered set instead, this is the wrong answer that caused the bug.
    expect(summarizePatients(excludeZeroValueRecords(rows)).get('P5')!.firstVisit).toBe('2026-06-12');
  });
});

/**
 * Why the count does not fall by the full length of the "new patients with zero first-visit
 * revenue" list. That list reports revenue on the first visit day; the toggle filters lines by
 * whether the visit carried any value at all, over the whole period.
 */
describe('a zero-revenue first visit does not always mean a zero-revenue patient', () => {
  const run = (rows: SaleRecord[]) => ({
    before: newPatients(rows, none),
    after: newPatients(rows, excludeZeroValueRecords),
  });

  it('keeps a patient whose first visit was free but who paid later the same month', () => {
    // A free consultation on the 2nd, a paid treatment on the 20th. They were acquired in June and
    // they brought revenue in June, so dropping them would understate the month's acquisitions
    // while still counting their money under Revenue.
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-06-02', serviceName: 'Consultation', amount: 0, redeemedAmount: 0 }),
      makeSale({ patientId: 'P1', date: '2026-06-20', serviceName: 'Filler', amount: 250 }),
    ];
    expect(run(rows)).toEqual({ before: 1, after: 1 });
  });

  it('keeps a patient whose first visit was a package session rather than free', () => {
    // Revenue is 0 because the package was paid for earlier, but value was delivered - this is not
    // a complimentary visit and the toggle deliberately leaves redemptions alone.
    const rows = [
      makeSale({ patientId: 'P2', date: '2026-06-15', serviceName: 'Restylane Kysse', amount: 0, redeemedAmount: 180, packageName: 'Filler Package' }),
    ];
    expect(run(rows)).toEqual({ before: 1, after: 1 });
  });

  it('drops a patient who was free on the first visit and never came back', () => {
    const rows = [
      makeSale({ patientId: 'P3', date: '2026-06-02', serviceName: 'Consultation', amount: 0, redeemedAmount: 0 }),
    ];
    expect(run(rows)).toEqual({ before: 1, after: 0 });
  });

  it('explains a list of three that only removes one', () => {
    // The shape of the June figures: three new patients with no first-visit revenue, of whom one
    // truly brought nothing. The headline falls by one, not by three.
    const rows = [
      makeSale({ patientId: 'PAID_LATER', date: '2026-06-02', amount: 0, redeemedAmount: 0 }),
      makeSale({ patientId: 'PAID_LATER', date: '2026-06-20', amount: 250 }),
      makeSale({ patientId: 'REDEEMED', date: '2026-06-15', amount: 0, redeemedAmount: 180, packageName: 'Pkg' }),
      makeSale({ patientId: 'NOTHING', date: '2026-06-02', amount: 0, redeemedAmount: 0 }),
    ];
    expect(run(rows)).toEqual({ before: 3, after: 2 });
  });
});

/**
 * The counting question that follows: if a patient is kept because they came free on the 2nd and
 * paid on the 20th, are they counted twice?
 */
describe('a patient with several visits in the month counts once', () => {
  const rows = () => [
    makeSale({ patientId: 'P1', date: '2026-06-02', amount: 0, redeemedAmount: 0 }),
    makeSale({ patientId: 'P1', date: '2026-06-20', amount: 250 }),
    makeSale({ patientId: 'P1', date: '2026-06-28', amount: 100 }),
    makeSale({ patientId: 'OLD', date: '2026-01-10', amount: 90 }),
    makeSale({ patientId: 'OLD', date: '2026-06-09', amount: 90 }),
  ];

  const kpis = (filter: (r: SaleRecord[]) => SaleRecord[]) =>
    computeKpis(filter(rows()), JUNE, summarizePatients(rows()), 60, '2026-06-30');

  it('counts three visits by one new patient as one new patient', () => {
    for (const filter of [none, excludeZeroValueRecords]) {
      expect(kpis(filter).newPatients).toBe(1);
    }
  });

  it('never counts the same person as both new and returning', () => {
    for (const filter of [none, excludeZeroValueRecords]) {
      const k = kpis(filter);
      expect(k.newPatients + k.returningPatients).toBe(k.activePatients);
      expect(k.returningPatients).toBe(1);
    }
  });

  it('counts each line of revenue once, and only under the patient who earned it', () => {
    const summary = computeNewPatientRevenueSummary(
      excludeZeroValueRecords(rows()), summarizePatients(rows()), JUNE,
    );
    // 250 + 100 from the new patient, 90 from the returning one. The free line adds nothing and is
    // filtered out anyway; nothing is counted twice because a visit was free.
    expect(summary.newPatientRevenue).toBe(350);
    expect(summary.returningPatientRevenue).toBe(90);
    expect(summary.newPatients).toBe(1);
    expect(summary.totalRevenue).toBe(440);
  });
});
