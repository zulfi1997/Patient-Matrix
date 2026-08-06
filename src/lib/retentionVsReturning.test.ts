import { describe, expect, it } from 'vitest';
import { computeKpis, previousPeriod, summarizePatients } from './metrics';
import { makeSale } from '../test/fixtures';
import type { DateRange } from './metrics';

// A 30-day period, so the prior window is 01-30 Jun.
const RANGE: DateRange = { start: '2026-07-01', end: '2026-07-30' };

describe('Returning Patients vs Retention Rate', () => {
  it('counts as retained only those seen in the immediately prior window', () => {
    // Both patients are "returning" - each had seen this provider before July. Only one was seen
    // in June, so only one can be retained from it. That is why the retention count is smaller,
    // and it is not a discrepancy.
    const records = [
      // Seen in June and again in July: returning AND retained.
      makeSale({ patientId: 'A', date: '2026-06-15', amount: 100 }),
      makeSale({ patientId: 'A', date: '2026-07-10', amount: 100 }),
      // Last seen in January, back in July: returning but never in the prior window.
      makeSale({ patientId: 'B', date: '2026-01-05', amount: 100 }),
      makeSale({ patientId: 'B', date: '2026-07-12', amount: 100 }),
      // First-ever visit in July: new, so neither.
      makeSale({ patientId: 'C', date: '2026-07-20', amount: 100 }),
    ];
    const k = computeKpis(records, RANGE, summarizePatients(records), 90, '2026-07-30');

    expect(k.activePatients).toBe(3);
    expect(k.newPatients).toBe(1);
    expect(k.returningPatients).toBe(2);
    expect(k.prevActivePatients).toBe(1);
    expect(k.retainedPatients).toBe(1);
    expect(k.retentionRate).toBe(100);
  });

  it('always leaves retained as a subset of returning', () => {
    // Anyone in the prior window necessarily first visited before the period, so they can never be
    // counted as new - which makes retained ⊆ returning by construction, whatever the data.
    const records = Array.from({ length: 20 }, (_, i) =>
      makeSale({ patientId: `P${i}`, date: i % 3 === 0 ? '2026-06-10' : '2026-07-05', amount: 10 }),
    ).concat(
      Array.from({ length: 7 }, (_, i) => makeSale({ patientId: `P${i * 3}`, date: '2026-07-15', amount: 10 })),
    );
    const k = computeKpis(records, RANGE, summarizePatients(records), 90, '2026-07-30');
    expect(k.retainedPatients).toBeLessThanOrEqual(k.returningPatients);
  });

  it('names a prior window of the same length, ending the day before', () => {
    expect(previousPeriod(RANGE)).toEqual({ start: '2026-06-01', end: '2026-06-30' });
    expect(previousPeriod({ start: '2026-07-01', end: '2026-07-31' })).toEqual({ start: '2026-05-31', end: '2026-06-30' });
  });
});
