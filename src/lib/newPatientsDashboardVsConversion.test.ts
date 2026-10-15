import { describe, expect, it } from 'vitest';
import { computeKpis, summarizePatients, type DateRange } from './metrics';
import { buildInvoiceToPatientMap, computeRangeConversion } from './conversionMetrics';
import { excludeFlaggedRecords } from './filters';
import { makeSale } from '../test/fixtures';
import type { SaleRecord } from '../types';

const JUNE: DateRange = { start: '2026-06-01', end: '2026-06-30' };

/**
 * Why the Dashboard's New Patients and Provider Conversion's New columns can disagree.
 *
 * They count different things and neither is a restatement of the other. The Dashboard counts
 * distinct people whose first-ever visit falls in the period. Conversion classifies each
 * patient-provider-day and counts the ones landing on its "new" rows. These pin the three ways the
 * two part company, so a difference of one can be read off the list rather than puzzled over.
 */

/** The Dashboard figure: distinct patients active in the period whose first-ever visit is in it. */
const dashboardNew = (visible: SaleRecord[], history: SaleRecord[]) =>
  computeKpis(visible, JUNE, summarizePatients(history), 60, '2026-06-30').newPatients;

/** The Conversion figure: patient-provider-days classified as New, converted or not. */
const conversionNew = (visible: SaleRecord[], history: SaleRecord[]) => {
  const summary = computeRangeConversion(
    visible, summarizePatients(history), JUNE, buildInvoiceToPatientMap(visible), new Map(),
  );
  return summary.overall.newConverted + summary.overall.newUnconverted;
};

describe('a first visit the YB111 toggle removed', () => {
  // Arrived on the 1st on a flagged invoice, came back and paid on the 10th.
  const history = () => [
    makeSale({ patientId: 'P1', staff: 'Dr A', date: '2026-06-01', amount: 100, invoiceNotes: 'YB111 under mr yasser' }),
    makeSale({ patientId: 'P1', staff: 'Dr A', date: '2026-06-10', amount: 300 }),
  ];

  it('is still a new patient on the Dashboard', () => {
    // History is read from every row, so their first-ever visit is the 1st and it is in the period.
    expect(dashboardNew(excludeFlaggedRecords(history()), history())).toBe(1);
  });

  it('is a repeat visit on Conversion, because the day it would have been new was filtered away', () => {
    // Conversion classifies the days it can see. The 10th is not their first visit, so it is a
    // repeat - and the 1st, where they would have been new, no longer exists to classify.
    expect(conversionNew(excludeFlaggedRecords(history()), history())).toBe(0);
  });

  it('still differs with the toggle off, for the other reason', () => {
    // Worth knowing before anyone unticks the box expecting the two to meet: the visit comes back,
    // but Conversion then sets it aside as a flagged follow-up, so its New count is unchanged.
    expect(dashboardNew(history(), history())).toBe(1);
    expect(conversionNew(history(), history())).toBe(0);
  });
});

describe('a new patient seen by two providers on their first day', () => {
  const rows = () => [
    makeSale({ patientId: 'P1', staff: 'Dr A', date: '2026-06-05', amount: 200 }),
    makeSale({ patientId: 'P1', staff: 'Dr B', date: '2026-06-05', amount: 150 }),
  ];

  it('is one person on the Dashboard and two rows on Conversion', () => {
    // Conversion's unit is the patient-provider-day, because its question is how each provider
    // handled the patient in front of them. The Dashboard counts people acquired.
    expect(dashboardNew(rows(), rows())).toBe(1);
    expect(conversionNew(rows(), rows())).toBe(2);
  });
});

describe('a first visit carrying a YB111 note while the toggle is off', () => {
  const rows = () => [
    makeSale({ patientId: 'P1', staff: 'Dr A', date: '2026-06-05', amount: 200, invoiceNotes: 'YB111' }),
  ];

  it('counts on the Dashboard but is a follow-up on Conversion', () => {
    // Conversion checks the flag before anything else: a flagged visit was never a conversion
    // opportunity, so it is set aside rather than counted as an acquisition.
    expect(dashboardNew(rows(), rows())).toBe(1);
    expect(conversionNew(rows(), rows())).toBe(0);
  });
});
