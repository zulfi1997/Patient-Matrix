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
