import { describe, expect, it } from 'vitest';
import { computeRevenueReconciliation } from './revenueReconciliation';
import { makeBatch, makeSale } from '../test/fixtures';
import type { DateRange } from './metrics';

const RANGE: DateRange = { start: '2026-07-01', end: '2026-07-28' };

// The figures the clinic reconciled against for 01-28 Jul 2026, from the source report.
const REPORTED_REVENUE = 49881.81;
const REPORTED_REDEEMED = 32438.63;
const REPORTED_GROSS = REPORTED_REVENUE + REPORTED_REDEEMED;

const clean = makeBatch({ id: 'b-clean', uploadedAt: '2026-07-30T09:00:00Z', fileName: 'manual-01-28-jul.xlsx' });
const stale = makeBatch({ id: 'b-stale', uploadedAt: '2026-07-29T18:48:00Z', fileName: 'All combined fil.xlsx' });

/** The two rows that reproduce the reported split, both from the authoritative import. */
function reportedRows() {
  return [
    makeSale({ id: 'rev', importBatchId: 'b-clean', amount: REPORTED_REVENUE }),
    makeSale({ id: 'red', importBatchId: 'b-clean', amount: 0, redeemedAmount: REPORTED_REDEEMED, packageName: 'Pkg' }),
  ];
}

const off = { excludeFlagged: false, excludeZeroValue: false };

describe('computeRevenueReconciliation', () => {
  it('opens on gross Sales (Exc. Tax), so it is comparable to the source report', () => {
    // Gross is amount + redeemedAmount because excelParser splits that one source column in two.
    const rec = computeRevenueReconciliation(reportedRows(), [clean], RANGE, off);
    expect(rec.sourceGross).toBeCloseTo(REPORTED_GROSS, 2);
    expect(rec.sourceRows).toBe(2);
  });

  it('closes on figures that add back to the gross it opened with', () => {
    const rec = computeRevenueReconciliation(reportedRows(), [clean], RANGE, off);
    expect(rec.revenue).toBeCloseTo(REPORTED_REVENUE, 2);
    expect(rec.redeemed).toBeCloseTo(REPORTED_REDEEMED, 2);
    expect(rec.revenue + rec.redeemed).toBeCloseTo(rec.finalGross, 2);
  });

  it('ignores rows outside the period', () => {
    const rows = [...reportedRows(), makeSale({ importBatchId: 'b-clean', date: '2026-06-30', amount: 999 })];
    expect(computeRevenueReconciliation(rows, [clean], RANGE, off).sourceGross).toBeCloseTo(REPORTED_GROSS, 2);
  });

  it('always excludes gift card and prepaid card purchases', () => {
    // Selling a card is not revenue until it is redeemed.
    const rows = [
      ...reportedRows(),
      makeSale({ importBatchId: 'b-clean', itemType: 'Gift card', amount: 3000 }),
      makeSale({ importBatchId: 'b-clean', itemType: 'Pre-paid card', amount: 1500 }),
    ];
    const rec = computeRevenueReconciliation(rows, [clean], RANGE, off);
    const cardStage = rec.stages[1];
    expect(cardStage.rowsRemoved).toBe(2);
    expect(cardStage.grossRemoved).toBeCloseTo(4500, 2);
    expect(rec.finalGross).toBeCloseTo(REPORTED_GROSS, 2);
  });

  it('leaves YB111 rows counted while the toggle is off, and says how many there are', () => {
    const rows = [...reportedRows(), makeSale({ importBatchId: 'b-clean', amount: 1200, invoiceNotes: 'YB111 adj' })];
    const stage = computeRevenueReconciliation(rows, [clean], RANGE, off).stages[2];
    expect(stage.inactive).toBe(true);
    expect(stage.grossRemoved).toBe(0);
    expect(stage.note).toContain('1 row(s)');
  });

  it('removes exactly the YB111 rows once the toggle is on', () => {
    const rows = [...reportedRows(), makeSale({ importBatchId: 'b-clean', amount: 1200, invoiceNotes: 'YB111 adj' })];
    const rec = computeRevenueReconciliation(rows, [clean], RANGE, { excludeFlagged: true, excludeZeroValue: false });
    expect(rec.stages[2].inactive).toBe(false);
    expect(rec.stages[2].grossRemoved).toBeCloseTo(1200, 2);
    expect(rec.finalGross).toBeCloseTo(REPORTED_GROSS, 2);
  });

  it('removes only genuinely zero-value rows once that toggle is on', () => {
    // A package redemption nets zero revenue but is a real, already-paid visit - it must survive.
    const rows = [
      ...reportedRows(),
      makeSale({ id: 'free', importBatchId: 'b-clean', amount: 0, redeemedAmount: 0 }),
    ];
    const rec = computeRevenueReconciliation(rows, [clean], RANGE, { excludeFlagged: false, excludeZeroValue: true });
    expect(rec.stages[3].rowsRemoved).toBe(1);
    expect(rec.stages[3].grossRemoved).toBe(0);
    expect(rec.redeemed).toBeCloseTo(REPORTED_REDEEMED, 2);
  });

  it('names one contributing import when only one covers the period', () => {
    const rec = computeRevenueReconciliation(reportedRows(), [clean], RANGE, off);
    expect(rec.contributions).toHaveLength(1);
    expect(rec.contributions[0].fileName).toBe('manual-01-28-jul.xlsx');
    expect(rec.supersededRows).toBe(0);
  });

  it('quantifies double-counting when two imports cover the same dates', () => {
    const dupes = reportedRows().map((r) => ({ ...r, id: `dup-${r.id}`, importBatchId: 'b-stale' }));
    const rec = computeRevenueReconciliation([...reportedRows(), ...dupes], [clean, stale], RANGE, off);

    expect(rec.contributions).toHaveLength(2);
    expect(rec.sourceGross).toBeCloseTo(REPORTED_GROSS * 2, 2);
    // The inflation is exactly the stale import, so clearing it leaves the reported figure.
    expect(rec.supersededGross).toBeCloseTo(REPORTED_GROSS, 2);
    expect(rec.finalGross - rec.supersededGross).toBeCloseTo(REPORTED_GROSS, 2);

    const staleRow = rec.contributions.find((c) => c.batchId === 'b-stale');
    expect(staleRow?.supersededRows).toBe(2);
    expect(rec.contributions.find((c) => c.batchId === 'b-clean')?.supersededRows).toBe(0);
  });

  it('labels rows whose import record is gone rather than showing a blank', () => {
    const rows = [makeSale({ importBatchId: 'b-vanished', amount: 10 })];
    const rec = computeRevenueReconciliation(rows, [], RANGE, off);
    expect(rec.contributions[0].fileName).toBe('(import no longer listed)');
  });

  it('handles an empty period without dividing by anything', () => {
    const rec = computeRevenueReconciliation([], [clean], RANGE, off);
    expect(rec.sourceRows).toBe(0);
    expect(rec.sourceGross).toBe(0);
    expect(rec.revenue).toBe(0);
    expect(rec.contributions).toEqual([]);
  });
});
