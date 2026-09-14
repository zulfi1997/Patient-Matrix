import { describe, expect, it } from 'vitest';
import {
  addMonths,
  averageByAge,
  cellValue,
  cohortRepeatTotal,
  cohortTotal,
  computePatientCohorts,
  contributionThrough,
  cumulativeValues,
  lastDayOfMonth,
  monthKeyOf,
  monthsBetween,
} from './patientCohorts';
import { summarizePatients } from './metrics';
import { makeSale } from '../test/fixtures';

const build = (rows: Parameters<typeof summarizePatients>[0], asOf = '2026-08-31') =>
  computePatientCohorts(rows, summarizePatients(rows), asOf);

const cohortFor = (analysis: ReturnType<typeof build>, month: string) =>
  analysis.cohorts.find((c) => c.cohortMonth === month)!;

describe('month arithmetic', () => {
  it('reduces a date to the first of its month', () => {
    expect(monthKeyOf('2026-05-17')).toBe('2026-05-01');
  });

  it('counts months across a year boundary', () => {
    expect(monthsBetween('2025-11-01', '2026-02-01')).toBe(3);
    expect(monthsBetween('2026-05-01', '2026-05-01')).toBe(0);
    expect(monthsBetween('2026-05-01', '2026-04-01')).toBe(-1);
  });

  it('adds months across a year boundary', () => {
    expect(addMonths('2026-11-01', 3)).toBe('2027-02-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
  });

  it('knows how long each month is, February included', () => {
    expect(lastDayOfMonth('2026-05-01')).toBe('2026-05-31');
    expect(lastDayOfMonth('2026-06-01')).toBe('2026-06-30');
    expect(lastDayOfMonth('2026-02-01')).toBe('2026-02-28');
    expect(lastDayOfMonth('2028-02-01')).toBe('2028-02-29');
  });
});

describe('computePatientCohorts', () => {
  it('follows one month of new patients forward into later months', () => {
    // The question the clinic asked: May's new patients, what did they bring by June.
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100 }),
      makeSale({ patientId: 'P1', date: '2026-06-12', amount: 60 }),
      makeSale({ patientId: 'P1', date: '2026-07-02', amount: 40 }),
    ];
    const may = cohortFor(build(rows), '2026-05-01');
    expect(may.patients).toBe(1);
    expect(may.cells.map((c) => c.revenue)).toEqual([100, 60, 40, 0]);
    expect(may.totalRevenue).toBe(200);
    expect(may.repeatRevenue).toBe(100);
  });

  it('keeps a patient in their acquisition cohort forever, not the month they happen to spend in', () => {
    // The whole point of a cohort: June's revenue from a May patient is May's cohort's credit.
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100 }),
      makeSale({ patientId: 'P1', date: '2026-06-12', amount: 500 }),
      makeSale({ patientId: 'P2', date: '2026-06-03', amount: 70 }),
    ];
    const analysis = build(rows);
    expect(cohortFor(analysis, '2026-05-01').cells[1].revenue).toBe(500);
    expect(cohortFor(analysis, '2026-06-01').cells[0].revenue).toBe(70);
  });

  it('counts a cohort member once however many times they visit', () => {
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-05-01', amount: 10 }),
      makeSale({ patientId: 'P1', date: '2026-05-20', amount: 10 }),
      makeSale({ patientId: 'P2', date: '2026-05-05', amount: 10 }),
    ];
    const may = cohortFor(build(rows), '2026-05-01');
    expect(may.patients).toBe(2);
    expect(may.cells[0].activePatients).toBe(2);
  });

  it('reports who came back, separately from what they spent', () => {
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100 }),
      makeSale({ patientId: 'P2', date: '2026-05-11', amount: 100 }),
      makeSale({ patientId: 'P3', date: '2026-05-12', amount: 100 }),
      makeSale({ patientId: 'P1', date: '2026-06-10', amount: 50 }),
      makeSale({ patientId: 'P1', date: '2026-07-10', amount: 50 }),
    ];
    const may = cohortFor(build(rows), '2026-05-01');
    expect(may.patients).toBe(3);
    // One patient returned, in two separate months - still one returning patient.
    expect(may.repeatPatients).toBe(1);
    expect(may.cells[1].activePatients).toBe(1);
    expect(may.cells[2].activePatients).toBe(1);
  });

  it('gives every cohort a cell for each month it has lived through, including silent ones', () => {
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100 }),
      makeSale({ patientId: 'P2', date: '2026-08-10', amount: 100 }),
    ];
    const analysis = build(rows);
    // A gap month has to be present and zero, or the age columns stop lining up across rows.
    expect(cohortFor(analysis, '2026-05-01').cells.map((c) => c.month)).toEqual([
      '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01',
    ]);
    expect(cohortFor(analysis, '2026-05-01').cells[1]).toMatchObject({ revenue: 0, activePatients: 0 });
    expect(cohortFor(analysis, '2026-08-01').cells).toHaveLength(1);
    expect(analysis.maxMonthIndex).toBe(3);
  });

  it('subtracts a later refund from the month it was given back in', () => {
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-05-10', amount: 500 }),
      makeSale({ patientId: 'P1', date: '2026-06-10', amount: -200, qty: -1 }),
    ];
    const may = cohortFor(build(rows), '2026-05-01');
    expect(may.cells[1].revenue).toBe(-200);
    expect(may.totalRevenue).toBe(300);
  });

  it('separates package cash from the sessions it later pays for', () => {
    // A package sold in May and consumed in June and July. On cash the cohort looks like it
    // stopped after May; on delivered value the work is visible in the months it happened.
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-05-10', itemType: 'Package', amount: 900 }),
      makeSale({ patientId: 'P1', date: '2026-06-10', amount: 0, redeemedAmount: 300, packageName: 'Derma' }),
      makeSale({ patientId: 'P1', date: '2026-07-10', amount: 0, redeemedAmount: 300, packageName: 'Derma' }),
    ];
    const may = cohortFor(build(rows), '2026-05-01');
    expect(may.cells.map((c) => c.revenue)).toEqual([900, 0, 0, 0]);
    expect(may.cells.map((c) => c.deliveredValue)).toEqual([900, 300, 300, 0]);
    expect(may.totalRevenue).toBe(900);
    expect(may.totalDeliveredValue).toBe(1500);
    expect(may.repeatRevenue).toBe(0);
    expect(may.repeatDeliveredValue).toBe(600);
  });

  it('marks the earliest cohort as unverifiable, and no other', () => {
    // Anyone first seen in the first month of data may have been a patient for years; there is no
    // earlier data to tell a genuine first-timer apart from a long-standing one.
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100 }),
      makeSale({ patientId: 'P2', date: '2026-06-10', amount: 100 }),
    ];
    const analysis = build(rows);
    expect(cohortFor(analysis, '2026-05-01').censored).toBe(true);
    expect(cohortFor(analysis, '2026-06-01').censored).toBe(false);
  });

  it('marks a month still in progress as partial', () => {
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100 }),
      makeSale({ patientId: 'P1', date: '2026-08-10', amount: 100 }),
    ];
    const may = cohortFor(build(rows, '2026-08-14'), '2026-05-01');
    expect(may.cells.map((c) => c.partial)).toEqual([false, false, false, true]);
  });

  it('does not call a month partial when the data runs to its last day', () => {
    const rows = [makeSale({ patientId: 'P1', date: '2026-06-10', amount: 100 })];
    expect(cohortFor(build(rows, '2026-06-30'), '2026-06-01').cells[0].partial).toBe(false);
  });

  it('orders cohorts oldest first', () => {
    const rows = [
      makeSale({ patientId: 'P2', date: '2026-07-10', amount: 10 }),
      makeSale({ patientId: 'P1', date: '2026-05-10', amount: 10 }),
      makeSale({ patientId: 'P3', date: '2026-06-10', amount: 10 }),
    ];
    expect(build(rows).cohorts.map((c) => c.cohortMonth)).toEqual([
      '2026-05-01', '2026-06-01', '2026-07-01',
    ]);
  });

  it('accounts for every row exactly once across all cohorts', () => {
    // The guard against double-counting: a cohort table that does not reconcile to total revenue
    // is worse than no table, because it looks authoritative.
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100 }),
      makeSale({ patientId: 'P1', date: '2026-06-10', amount: 250 }),
      makeSale({ patientId: 'P2', date: '2026-06-11', amount: 75 }),
      makeSale({ patientId: 'P3', date: '2026-07-01', amount: -40, qty: -1 }),
      makeSale({ patientId: 'P2', date: '2026-08-02', amount: 60, redeemedAmount: 20, packageName: 'X' }),
    ];
    const analysis = build(rows);
    const totalRevenue = analysis.cohorts.reduce((s, c) => s + c.totalRevenue, 0);
    const totalDelivered = analysis.cohorts.reduce((s, c) => s + c.totalDeliveredValue, 0);
    expect(totalRevenue).toBe(rows.reduce((s, r) => s + r.amount, 0));
    expect(totalDelivered).toBe(rows.reduce((s, r) => s + r.amount + r.redeemedAmount, 0));
  });

  it('counts every patient exactly once across all cohorts', () => {
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-05-10', amount: 10 }),
      makeSale({ patientId: 'P1', date: '2026-06-10', amount: 10 }),
      makeSale({ patientId: 'P2', date: '2026-06-11', amount: 10 }),
    ];
    const analysis = build(rows);
    expect(analysis.cohorts.reduce((s, c) => s + c.patients, 0)).toBe(2);
  });

  it('returns nothing rather than throwing when no data is loaded', () => {
    expect(build([])).toMatchObject({ cohorts: [], months: [], maxMonthIndex: 0 });
  });

  it('ignores a record whose patient is absent from the summary', () => {
    // Only reachable by passing mismatched inputs; grouping it under a guessed cohort would be
    // worse than leaving it out, since it would silently shift money between months.
    const rows = [makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100 })];
    const analysis = computePatientCohorts(rows, new Map(), '2026-05-31');
    expect(analysis.cohorts).toEqual([]);
  });
});

describe('cumulativeValues', () => {
  it('answers "how much by June" by reading the second cell', () => {
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100 }),
      makeSale({ patientId: 'P1', date: '2026-06-12', amount: 60 }),
      makeSale({ patientId: 'P1', date: '2026-07-02', amount: 40 }),
    ];
    const may = cohortFor(build(rows), '2026-05-01');
    expect(cumulativeValues(may, 'revenue')).toEqual([100, 160, 200, 200]);
  });

  it('ends at the lifetime total under either basis', () => {
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100, redeemedAmount: 25, packageName: 'X' }),
      makeSale({ patientId: 'P1', date: '2026-06-12', amount: 60 }),
    ];
    const may = cohortFor(build(rows), '2026-05-01');
    for (const basis of ['revenue', 'deliveredValue'] as const) {
      const running = cumulativeValues(may, basis);
      expect(running[running.length - 1]).toBe(cohortTotal(may, basis));
    }
  });
});

describe('contributionThrough', () => {
  const rows = () => [
    makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100 }),
    makeSale({ patientId: 'P1', date: '2026-06-12', amount: 60 }),
    makeSale({ patientId: 'P1', date: '2026-07-02', amount: 40 }),
  ];

  it('states what May had brought in by the end of June', () => {
    const may = cohortFor(build(rows()), '2026-05-01');
    expect(contributionThrough(may, '2026-06-30', 'revenue')).toBe(160);
    expect(contributionThrough(may, '2026-06-01', 'revenue')).toBe(160);
  });

  it('says nothing rather than zero for a month before the cohort existed', () => {
    const may = cohortFor(build(rows()), '2026-05-01');
    expect(contributionThrough(may, '2026-04-30', 'revenue')).toBeNull();
  });

  it('says nothing for a month the data has not reached', () => {
    const may = cohortFor(build(rows()), '2026-05-01');
    expect(contributionThrough(may, '2026-12-31', 'revenue')).toBeNull();
  });
});

describe('averageByAge', () => {
  const rows = () => [
    // June cohort: two patients, spending in June and July.
    makeSale({ patientId: 'P1', date: '2026-06-10', amount: 100 }),
    makeSale({ patientId: 'P2', date: '2026-06-11', amount: 100 }),
    makeSale({ patientId: 'P1', date: '2026-07-10', amount: 50 }),
    // July cohort: one patient, spending in July only.
    makeSale({ patientId: 'P3', date: '2026-07-20', amount: 300 }),
    // May is the earliest month, so it is censored and excluded by default.
    makeSale({ patientId: 'P0', date: '2026-05-01', amount: 999 }),
  ];

  it('compares cohorts at the same age rather than by how long ago they arrived', () => {
    const byAge = averageByAge(build(rows(), '2026-07-31').cohorts, 'revenue');
    const month0 = byAge.find((a) => a.monthIndex === 0)!;
    // June's 200 over two patients, plus July's 300 over one: 500 over three.
    expect(month0).toMatchObject({ cohorts: 2, patients: 3, value: 500 });
    expect(month0.valuePerPatient).toBeCloseTo(500 / 3, 10);
  });

  it('leaves the censored first cohort out, since its patients are not verifiably new', () => {
    const cohorts = build(rows(), '2026-07-31').cohorts;
    expect(averageByAge(cohorts, 'revenue')[0].value).toBe(500);
    const withCensored = averageByAge(cohorts, 'revenue', { includeCensored: true })[0];
    expect(withCensored.value).toBe(1499);
    expect(withCensored.cohorts).toBe(3);
  });

  it('only counts a cohort at an age it has actually reached', () => {
    const byAge = averageByAge(build(rows(), '2026-07-31').cohorts, 'revenue');
    // Only June is old enough to have a second month, so July must not dilute the average.
    expect(byAge.find((a) => a.monthIndex === 1)).toMatchObject({ cohorts: 1, patients: 2, value: 50 });
  });

  it('excludes a partial month, which would otherwise drag the age average down', () => {
    // Data stops mid-July, so every July cell is still filling.
    const cohorts = build(rows(), '2026-07-15').cohorts;
    expect(averageByAge(cohorts, 'revenue').find((a) => a.monthIndex === 1)).toBeUndefined();
    expect(averageByAge(cohorts, 'revenue', { includePartial: true })!
      .find((a) => a.monthIndex === 1)).toMatchObject({ value: 50 });
  });
});

describe('basis selectors', () => {
  it('reads the same cell two ways', () => {
    const rows = [makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100, redeemedAmount: 40, packageName: 'X' })];
    const may = cohortFor(build(rows), '2026-05-01');
    expect(cellValue(may.cells[0], 'revenue')).toBe(100);
    expect(cellValue(may.cells[0], 'deliveredValue')).toBe(140);
    expect(cohortTotal(may, 'deliveredValue')).toBe(140);
    expect(cohortRepeatTotal(may, 'revenue')).toBe(0);
  });
});
