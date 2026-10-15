import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addPackageBenefitSnapshot, clearAllPackageBenefits, getAllPackageBenefits, getAllPackageBenefitBatches, getAllPnlBatches } from './db';
import type { PackageBenefitBatch, PackageBenefitRecord } from '../types';

const benefit = (snapshotDate: string, i: number): PackageBenefitRecord =>
  ({
    id: `${snapshotDate}-${i}`, snapshotDate, saleCenter: 'Main', invoiceNo: `INV${i}`,
    packageCode: null, packageName: 'Pkg', packageCategory: 'Derma', guestName: 'A',
    benefitType: 'Service', benefitName: 'Facial', accruedQty: 1, value: 100,
    redeemedQty: 0, redeemedValue: 0, balanceQty: 1, packageStatus: 'Active',
  }) as PackageBenefitRecord;

const batch = (snapshotDate: string, rowCount: number): PackageBenefitBatch => ({
  snapshotDate, fileName: `${snapshotDate}.xlsx`, uploadedAt: new Date().toISOString(), rowCount,
});

describe('clearAllPackageBenefits', () => {
  beforeEach(async () => {
    await clearAllPackageBenefits();
  });

  it('removes every snapshot and every row behind them in one go', async () => {
    // The reason this exists: snapshots accumulate one file a day, so removing them one date at a
    // time means over a hundred confirmations.
    for (const date of ['2026-07-29', '2026-07-30', '2026-07-31']) {
      await addPackageBenefitSnapshot(batch(date, 2), [benefit(date, 1), benefit(date, 2)]);
    }
    expect(await getAllPackageBenefitBatches()).toHaveLength(3);
    expect(await getAllPackageBenefits()).toHaveLength(6);

    await clearAllPackageBenefits();

    expect(await getAllPackageBenefitBatches()).toEqual([]);
    expect(await getAllPackageBenefits()).toEqual([]);
  });

  it('leaves other stores alone', async () => {
    // Shares a database with the sales, collections and P&L stores, so a clear scoped wrongly would
    // take out data nobody asked to remove.
    await addPackageBenefitSnapshot(batch('2026-07-31', 1), [benefit('2026-07-31', 1)]);
    const pnlBefore = await getAllPnlBatches();
    await clearAllPackageBenefits();
    expect(await getAllPnlBatches()).toEqual(pnlBefore);
  });

  it('is safe to run when there is nothing to clear', async () => {
    await expect(clearAllPackageBenefits()).resolves.toBeUndefined();
    expect(await getAllPackageBenefits()).toEqual([]);
  });
});

/**
 * The writes inside a snapshot import are issued together and awaited as a batch rather than one
 * awaited round trip per row, which is what made importing a month of dailies take minutes. These
 * pin that the batching did not change what ends up stored.
 */
describe('snapshot writes are batched without changing the result', () => {
  beforeEach(async () => {
    await clearAllPackageBenefits();
  });

  it('stores every row of a large snapshot', async () => {
    const rows = Array.from({ length: 2_000 }, (_, i) => benefit('2026-08-24', i));
    await addPackageBenefitSnapshot(batch('2026-08-24', rows.length), rows);
    expect(await getAllPackageBenefits()).toHaveLength(2_000);
  });

  it('keeps several dates side by side', async () => {
    for (const date of ['2026-08-22', '2026-08-23', '2026-08-24']) {
      await addPackageBenefitSnapshot(batch(date, 3), Array.from({ length: 3 }, (_, i) => benefit(date, i)));
    }
    expect(await getAllPackageBenefits()).toHaveLength(9);
    expect((await getAllPackageBenefitBatches()).map((b) => b.snapshotDate).sort()).toEqual([
      '2026-08-22', '2026-08-23', '2026-08-24',
    ]);
  });

  it('replaces a date wholesale when the same day is re-imported', async () => {
    // A snapshot is a full statement of one day, not an incremental log: re-uploading must not
    // leave yesterday's extra rows behind.
    await addPackageBenefitSnapshot(batch('2026-08-24', 5), Array.from({ length: 5 }, (_, i) => benefit('2026-08-24', i)));
    await addPackageBenefitSnapshot(batch('2026-08-24', 2), Array.from({ length: 2 }, (_, i) => benefit('2026-08-24', i)));
    const stored = await getAllPackageBenefits();
    expect(stored).toHaveLength(2);
    expect(stored.every((r) => r.snapshotDate === '2026-08-24')).toBe(true);
  });

  it('leaves other dates untouched when one is replaced', async () => {
    await addPackageBenefitSnapshot(batch('2026-08-23', 4), Array.from({ length: 4 }, (_, i) => benefit('2026-08-23', i)));
    await addPackageBenefitSnapshot(batch('2026-08-24', 4), Array.from({ length: 4 }, (_, i) => benefit('2026-08-24', i)));
    await addPackageBenefitSnapshot(batch('2026-08-24', 1), [benefit('2026-08-24', 0)]);
    const byDate = await getAllPackageBenefits();
    expect(byDate.filter((r) => r.snapshotDate === '2026-08-23')).toHaveLength(4);
    expect(byDate.filter((r) => r.snapshotDate === '2026-08-24')).toHaveLength(1);
  });
});
