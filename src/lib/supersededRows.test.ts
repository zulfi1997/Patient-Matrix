import { describe, expect, it } from 'vitest';
import { findSupersededRows } from './supersededRows';
import { makeBatch, makeSale } from '../test/fixtures';

/**
 * A sales export restates every day it covers, so where a later import re-covers the same dates
 * its version wins. These tests pin both halves of that: what must be retired, and - more easily
 * broken - what must be left alone.
 */
describe('findSupersededRows', () => {
  const older = makeBatch({ id: 'b-old', uploadedAt: '2026-07-29T18:48:00Z', fileName: 'All combined fil.xlsx' });
  const newer = makeBatch({ id: 'b-new', uploadedAt: '2026-07-29T18:49:29Z', fileName: 'zenoti-sync-07-21.xlsx' });
  const batches = [older, newer];

  it('retires a row no later import contains at all - a voided invoice', () => {
    // The case row-to-row matching can never handle: an invoice voided in Zenoti is simply absent
    // from the newer export, so there is no incoming row to match it against.
    const rows = [
      makeSale({ id: 'void', importBatchId: 'b-old', invoiceNo: 'INV-VOID', date: '2026-07-09', amount: 5000 }),
      makeSale({ id: 'kept', importBatchId: 'b-new', invoiceNo: 'INV-A', date: '2026-07-05', amount: 120 }),
      makeSale({ id: 'kept2', importBatchId: 'b-new', invoiceNo: 'INV-C', date: '2026-07-20', amount: 60 }),
    ];
    const { removeIds, revenueImpact } = findSupersededRows(rows, batches);
    expect(removeIds).toEqual(['void']);
    expect(revenueImpact).toBe(5000);
  });

  it('removes the older copy of a restated line and keeps the newer one', () => {
    const rows = [
      makeSale({ id: 'old-A', importBatchId: 'b-old', date: '2026-07-05', amount: 120 }),
      makeSale({ id: 'new-A', importBatchId: 'b-new', date: '2026-07-05', amount: 120 }),
    ];
    const { removeIds } = findSupersededRows(rows, batches);
    expect(removeIds).toEqual(['old-A']);
  });

  it('leaves rows dated before the later import began', () => {
    const rows = [
      makeSale({ id: 'june', importBatchId: 'b-old', date: '2026-06-15', amount: 40 }),
      makeSale({ id: 'july', importBatchId: 'b-new', date: '2026-07-05', amount: 120 }),
    ];
    expect(findSupersededRows(rows, batches).removeIds).toEqual([]);
  });

  it('leaves rows dated after the later import ended', () => {
    const rows = [
      makeSale({ id: 'aug', importBatchId: 'b-old', date: '2026-08-02', amount: 40 }),
      makeSale({ id: 'july', importBatchId: 'b-new', date: '2026-07-05', amount: 120 }),
    ];
    expect(findSupersededRows(rows, batches).removeIds).toEqual([]);
  });

  it('leaves rows for a center the later import never covers', () => {
    // Otherwise a single-center export would silently wipe another branch's day.
    const rows = [
      makeSale({ id: 'branch2', importBatchId: 'b-old', date: '2026-07-05', centerName: 'Branch2', amount: 70 }),
      makeSale({ id: 'main', importBatchId: 'b-new', date: '2026-07-05', centerName: 'Main', amount: 120 }),
    ];
    expect(findSupersededRows(rows, batches).removeIds).toEqual([]);
  });

  it('keeps every legitimately repeated session captured within one batch', () => {
    // Two sessions of the same service on one invoice are real. Both newer copies survive; both
    // older copies go.
    const rows = [
      makeSale({ id: 'old-1', importBatchId: 'b-old', date: '2026-07-06', amount: 60 }),
      makeSale({ id: 'old-2', importBatchId: 'b-old', date: '2026-07-06', amount: 60 }),
      makeSale({ id: 'new-1', importBatchId: 'b-new', date: '2026-07-06', amount: 60 }),
      makeSale({ id: 'new-2', importBatchId: 'b-new', date: '2026-07-06', amount: 60 }),
    ];
    const { removeIds, rowCount } = findSupersededRows(rows, batches);
    expect(removeIds.sort()).toEqual(['old-1', 'old-2']);
    expect(rowCount).toBe(2);
  });

  it('never supersedes rows from the most recent import', () => {
    const rows = [
      makeSale({ id: 'new-a', importBatchId: 'b-new', date: '2026-07-05', amount: 10 }),
      makeSale({ id: 'new-b', importBatchId: 'b-new', date: '2026-07-06', amount: 10 }),
    ];
    expect(findSupersededRows(rows, batches).removeIds).toEqual([]);
  });

  it('attributes rows to the newest of several overlapping later imports', () => {
    const newest = makeBatch({ id: 'b-newest', uploadedAt: '2026-07-29T19:00:00Z', fileName: 'newest.xlsx' });
    const rows = [
      makeSale({ id: 'old', importBatchId: 'b-old', date: '2026-07-05', amount: 120 }),
      makeSale({ id: 'mid', importBatchId: 'b-new', date: '2026-07-05', amount: 120 }),
      makeSale({ id: 'top', importBatchId: 'b-newest', date: '2026-07-05', amount: 120 }),
    ];
    const { removeIds, groups } = findSupersededRows(rows, [older, newer, newest]);
    expect(removeIds.sort()).toEqual(['mid', 'old']);
    expect(groups).toHaveLength(1);
    expect(groups[0].batchId).toBe('b-newest');
    expect(groups[0].fromBatches.map((f) => f.batchId).sort()).toEqual(['b-new', 'b-old']);
  });

  it('reports revenue and redemption impact separately', () => {
    const rows = [
      makeSale({ id: 'old-rev', importBatchId: 'b-old', date: '2026-07-05', amount: 100 }),
      makeSale({ id: 'old-red', importBatchId: 'b-old', date: '2026-07-05', amount: 0, redeemedAmount: 250 }),
      makeSale({ id: 'new', importBatchId: 'b-new', date: '2026-07-05', amount: 100 }),
    ];
    const summary = findSupersededRows(rows, batches);
    expect(summary.revenueImpact).toBe(100);
    expect(summary.redeemedImpact).toBe(250);
  });

  it('ignores rows whose batch record is gone rather than throwing', () => {
    const rows = [makeSale({ id: 'orphan', importBatchId: 'b-missing', date: '2026-07-05', amount: 10 })];
    expect(findSupersededRows(rows, batches).removeIds).toEqual([]);
  });

  it('returns nothing when a single import supplies everything', () => {
    const rows = [
      makeSale({ id: 'a', importBatchId: 'b-new', date: '2026-07-05', amount: 10 }),
      makeSale({ id: 'b', importBatchId: 'b-new', date: '2026-07-06', amount: 10 }),
    ];
    const summary = findSupersededRows(rows, [newer]);
    expect(summary.rowCount).toBe(0);
    expect(summary.groups).toEqual([]);
  });
});
