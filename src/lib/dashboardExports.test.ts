import { describe, expect, it } from 'vitest';
import { conversionSheets, patientCohortSheets } from './dashboardExports';
import { computePatientCohorts } from './patientCohorts';
import { summarizePatients } from './metrics';
import { makeSale } from '../test/fixtures';
import { CONVERSION_CATEGORY_LABELS, FOLLOW_UP_REASON_LABELS, type PatientConversionRow, type ProviderConversionStat } from './conversionMetrics';

const stat = (over: Partial<ProviderConversionStat> = {}): ProviderConversionStat => ({
  staff: 'Dr Fatima',
  newUnconverted: 1,
  newConverted: 3,
  repeatUnconverted: 2,
  repeatConverted: 4,
  followUp: 5,
  followUpByReason: { yb111: 1, packageRedemption: 3, packageBalance: 1 },
  total: 15,
  conversionRate: 70,
  revenue: 1234.5,
  revenueAdjustment: 0,
  ...over,
});

const row = (over: Partial<PatientConversionRow> = {}): PatientConversionRow => ({
  patientId: 'MUS1',
  patientName: 'Test Patient',
  staff: 'Dr Fatima',
  date: '2026-07-10',
  revenue: 100,
  category: 'newConverted',
  followUpReason: null,
  services: ['HydraFacial'],
  hasPackageRedemption: false,
  isYB111: false,
  isFirstVisit: true,
  ...over,
});

const sheets = (over: Partial<Parameters<typeof conversionSheets>[0]> = {}) =>
  conversionSheets({
    providers: [stat()],
    patientRows: [row()],
    categoryLabels: CONVERSION_CATEGORY_LABELS,
    followUpLabels: FOLLOW_UP_REASON_LABELS,
    ...over,
  });

const byProvider = (s: ReturnType<typeof sheets>) => s.find((x) => x.name === 'By Provider')!.rows;

describe('conversionSheets', () => {
  it('adds an All Providers total row when an overall stat is given', () => {
    const rows = byProvider(sheets({ overall: stat({ staff: 'ignored', total: 40 }) }));
    expect(rows.map((r) => r.Provider)).toEqual(['Dr Fatima', 'All Providers']);
    expect(rows[1]['Visits Classified']).toBe(40);
  });

  it('omits the total row when the workbook is already scoped to one provider', () => {
    // Provider Analytics exports a single provider. A totals row identical to the only data row
    // reads as a second provider and doubles every figure in a pivot built on this sheet.
    expect(byProvider(sheets()).map((r) => r.Provider)).toEqual(['Dr Fatima']);
  });

  it('splits the patient rows into per-category sheets', () => {
    const s = sheets({
      patientRows: [
        row({ patientId: 'A', category: 'newConverted' }),
        row({ patientId: 'B', category: 'repeatUnconverted' }),
        row({ patientId: 'C', category: 'followUp', followUpReason: 'packageRedemption' }),
      ],
    });
    const named = (name: string) => s.find((x) => x.name === name)!.rows;
    expect(named('New Patients').map((r) => r['Patient ID'])).toEqual(['A']);
    expect(named('New Patients')[0].Converted).toBe('Yes');
    expect(named('Repeat Patients')[0].Converted).toBe('No');
    // A follow-up was never a conversion opportunity, so "No" would misread as a failure.
    expect(named('Follow-ups')[0].Converted).toBe('');
  });
});

describe('patientCohortSheets', () => {
  const analysis = () =>
    computePatientCohorts(
      [
        makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100 }),
        makeSale({ patientId: 'P1', date: '2026-06-12', amount: 60, redeemedAmount: 20, packageName: 'X' }),
        makeSale({ patientId: 'P2', date: '2026-06-03', amount: 70 }),
      ],
      summarizePatients([
        makeSale({ patientId: 'P1', date: '2026-05-10', amount: 100 }),
        makeSale({ patientId: 'P1', date: '2026-06-12', amount: 60, redeemedAmount: 20, packageName: 'X' }),
        makeSale({ patientId: 'P2', date: '2026-06-03', amount: 70 }),
      ]),
      '2026-06-30',
    );

  const sheet = (name: string) => patientCohortSheets(analysis()).find((s) => s.name === name)!.rows;

  it('exports the grid long, one row per cohort per month, so it pivots', () => {
    const rows = sheet('Cohort by Month');
    // May lived through two months, June through one.
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => [r['Cohort Month'], r['Calendar Month']])).toEqual([
      ['2026-05-01', '2026-05-01'],
      ['2026-05-01', '2026-06-01'],
      ['2026-06-01', '2026-06-01'],
    ]);
  });

  it('carries the running total, so "by June" needs no formula in the sheet', () => {
    const may = sheet('Cohort by Month').filter((r) => r['Cohort Month'] === '2026-05-01');
    expect(may.map((r) => r['Cumulative Cash Revenue'])).toEqual([100, 160]);
    expect(may.map((r) => r['Cumulative Delivered Value'])).toEqual([100, 180]);
  });

  it('keeps the money numeric rather than formatted, so a pivot can sum it', () => {
    for (const row of sheet('Cohort by Month')) {
      expect(typeof row['Cash Revenue']).toBe('number');
    }
  });

  it('states whether a cohort can be trusted and whether its month has finished', () => {
    const rows = sheet('Cohort by Month');
    expect(rows[0]['First Visit Verifiable']).toBe('No');
    expect(rows[2]['First Visit Verifiable']).toBe('Yes');
    expect(rows.every((r) => r['Month Still In Progress'] === 'No')).toBe(true);
  });

  it('summarizes what each cohort came back and spent', () => {
    const may = sheet('Cohort Summary').find((r) => r['Cohort Month'] === '2026-05-01')!;
    expect(may).toMatchObject({
      'New Patients': 1,
      'Lifetime Cash Revenue': 160,
      'First Month Cash': 100,
      'Cash After First Month': 60,
      'Patients Who Returned': 1,
    });
    const june = sheet('Cohort Summary').find((r) => r['Cohort Month'] === '2026-06-01')!;
    expect(june).toMatchObject({ 'Cash After First Month': 0, 'Patients Who Returned': 0 });
  });

  it('gives the age averages under both bases, labelled', () => {
    const rows = sheet('Average by Age');
    expect(new Set(rows.map((r) => r.Basis))).toEqual(new Set(['Cash Revenue', 'Delivered Value']));
    // May is the censored first cohort, so only June is averaged at age 0.
    const cash = rows.find((r) => r.Basis === 'Cash Revenue' && r['Months Since First Visit'] === 0)!;
    expect(cash).toMatchObject({ 'Cohorts Averaged': 1, Total: 70 });
  });
});
