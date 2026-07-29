import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as db from './db';
import { makeBatch, makeSale } from '../test/fixtures';

/**
 * addBatch deletes data, so these cover both what it must replace and what it must leave alone -
 * the latter being where a mistake silently loses real sales.
 */
describe('addBatch', () => {
  beforeEach(async () => {
    await db.clearAllTransactions();
  });

  const olderBatch = makeBatch({
    id: 'b-old',
    uploadedAt: '2026-07-29T18:48:00Z',
    fileName: 'All combined fil.xlsx',
    dateRange: { min: '2026-06-15', max: '2026-07-09' },
  });

  /** Pre-existing rows: one the new file restates, one voided, one earlier, one at another center. */
  async function seedOlderImport() {
    await db.addBatch(olderBatch, [
      makeSale({ id: 'old-A', importBatchId: 'b-old', invoiceNo: 'INV-A', date: '2026-07-05', amount: 120 }),
      makeSale({ id: 'old-VOID', importBatchId: 'b-old', invoiceNo: 'INV-VOID', date: '2026-07-09', amount: 5000 }),
      makeSale({ id: 'old-JUN', importBatchId: 'b-old', invoiceNo: 'INV-JUN', date: '2026-06-15', amount: 40 }),
      makeSale({ id: 'old-BR2', importBatchId: 'b-old', invoiceNo: 'INV-BR2', date: '2026-07-05', centerName: 'Branch2', amount: 70 }),
    ]);
  }

  const newerBatch = makeBatch({
    id: 'b-new',
    uploadedAt: '2026-07-30T09:00:00Z',
    fileName: 'zenoti-sync-07-20.xlsx',
    dateRange: { min: '2026-07-05', max: '2026-07-20' },
  });

  const newerRows = () => [
    makeSale({ id: 'new-A', importBatchId: 'b-new', invoiceNo: 'INV-A', date: '2026-07-05', amount: 120 }),
    makeSale({ id: 'new-C', importBatchId: 'b-new', invoiceNo: 'INV-C', date: '2026-07-20', amount: 60 }),
  ];

  async function invoicesNow() {
    return (await db.getAllTransactions()).map((r) => r.invoiceNo).sort();
  }

  it('retires an invoice the newer file does not contain', async () => {
    await seedOlderImport();
    await db.addBatch(newerBatch, newerRows());
    expect(await invoicesNow()).not.toContain('INV-VOID');
  });

  it('does not leave a restated line stored twice', async () => {
    await seedOlderImport();
    await db.addBatch(newerBatch, newerRows());
    const all = await db.getAllTransactions();
    expect(all.filter((r) => r.invoiceNo === 'INV-A')).toHaveLength(1);
    expect(all.find((r) => r.invoiceNo === 'INV-A')?.importBatchId).toBe('b-new');
  });

  it('keeps rows dated before the incoming range', async () => {
    await seedOlderImport();
    await db.addBatch(newerBatch, newerRows());
    expect(await invoicesNow()).toContain('INV-JUN');
  });

  it('keeps rows for a center the incoming file never covers', async () => {
    await seedOlderImport();
    await db.addBatch(newerBatch, newerRows());
    expect(await invoicesNow()).toContain('INV-BR2');
  });

  it('leaves the period totalling only what the newer file states', async () => {
    await seedOlderImport();
    await db.addBatch(newerBatch, newerRows());
    const total = (await db.getAllTransactions()).reduce((s, r) => s + r.amount, 0);
    // 120 + 60 restated, plus the two survivors outside the replaced scope (40 June, 70 Branch2).
    expect(total).toBe(120 + 60 + 40 + 70);
  });

  it('reports and stores how many rows it superseded', async () => {
    await seedOlderImport();
    const { superseded, added } = await db.addBatch(newerBatch, newerRows());
    expect(superseded).toBe(2); // old-A and old-VOID
    expect(added).toBe(2);
    const stored = (await db.getAllBatches()).find((b) => b.id === 'b-new');
    expect(stored?.supersededCount).toBe(2);
  });

  it('refreshes its own rows on re-upload instead of superseding them', async () => {
    await db.addBatch(newerBatch, newerRows());
    const again = await db.addBatch(newerBatch, newerRows());
    expect(again.superseded).toBe(0);
    expect(again.refreshed).toBe(2);
    expect(again.added).toBe(0);
    expect(await db.getAllTransactions()).toHaveLength(2);
  });

  it('picks up corrected values when the same file is re-imported', async () => {
    await db.addBatch(newerBatch, newerRows());
    const corrected = newerRows().map((r) => (r.id === 'new-A' ? { ...r, amount: 99 } : r));
    await db.addBatch(newerBatch, corrected);
    const all = await db.getAllTransactions();
    expect(all.find((r) => r.id === 'new-A')?.amount).toBe(99);
  });

  it('replaces nothing when the incoming file has no rows', async () => {
    await seedOlderImport();
    const empty = makeBatch({ id: 'b-empty', uploadedAt: '2026-07-31T09:00:00Z', dateRange: null });
    const { superseded } = await db.addBatch(empty, []);
    expect(superseded).toBe(0);
    expect(await db.getAllTransactions()).toHaveLength(4);
  });

  it('replaces only the days it covers, leaving a later import intact', async () => {
    // A backfill uploaded after a newer sync must not wipe days it does not reach.
    await db.addBatch(
      makeBatch({ id: 'b-late', uploadedAt: '2026-07-31T09:00:00Z', dateRange: { min: '2026-07-27', max: '2026-07-28' } }),
      [makeSale({ id: 'late', importBatchId: 'b-late', invoiceNo: 'INV-LATE', date: '2026-07-28', amount: 55 })],
    );
    await db.addBatch(newerBatch, newerRows());
    expect(await invoicesNow()).toContain('INV-LATE');
  });
});
