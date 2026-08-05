import { describe, expect, it } from 'vitest';
import { conversionSheets } from './dashboardExports';
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
    expect(rows[1]['Total Patients']).toBe(40);
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
