import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ImportBatch, PackageBenefitBatch, PackageBenefitRecord, PnlImportBatch, PnlLineRecord, SaleRecord } from '../types';

interface PatientMatrixDB extends DBSchema {
  transactions: {
    key: string;
    value: SaleRecord;
    indexes: { 'by-batch': string; 'by-patient': string };
  };
  batches: {
    key: string;
    value: ImportBatch;
  };
  packageBenefits: {
    key: string;
    value: PackageBenefitRecord;
    indexes: { 'by-snapshot': string };
  };
  packageBenefitBatches: {
    key: string;
    value: PackageBenefitBatch;
  };
  pnlLines: {
    key: string;
    value: PnlLineRecord;
    indexes: { 'by-month': string };
  };
  pnlBatches: {
    key: string;
    value: PnlImportBatch;
  };
}

const DB_NAME = 'patient-matrix';
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<PatientMatrixDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<PatientMatrixDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const tx = db.createObjectStore('transactions', { keyPath: 'id' });
          tx.createIndex('by-batch', 'importBatchId');
          tx.createIndex('by-patient', 'patientId');
          db.createObjectStore('batches', { keyPath: 'id' });
        }
        if (oldVersion < 2) {
          const pb = db.createObjectStore('packageBenefits', { keyPath: 'id' });
          pb.createIndex('by-snapshot', 'snapshotDate');
          db.createObjectStore('packageBenefitBatches', { keyPath: 'snapshotDate' });
        }
        if (oldVersion < 3) {
          const pnl = db.createObjectStore('pnlLines', { keyPath: 'id' });
          pnl.createIndex('by-month', 'month');
          db.createObjectStore('pnlBatches', { keyPath: 'month' });
        }
      },
    });
  }
  return dbPromise;
}

export async function getAllTransactions(): Promise<SaleRecord[]> {
  const db = await getDB();
  return db.getAll('transactions');
}

export async function getAllBatches(): Promise<ImportBatch[]> {
  const db = await getDB();
  const batches = await db.getAll('batches');
  return batches.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/**
 * Adds transactions. A row whose id already exists (dedup across
 * overlapping/re-uploaded exports) is refreshed in place with the newly
 * parsed values rather than skipped, so re-uploading the same export after
 * an app update (a parsing bug fix, a new derived field, etc.) heals
 * already-stored data instead of leaving it stuck with stale values. The
 * row keeps its original importBatchId so batch history/deletion still
 * reflects when it was first imported.
 */
export async function addBatch(
  batch: ImportBatch,
  records: SaleRecord[],
): Promise<{ added: number; refreshed: number }> {
  const db = await getDB();
  const tx = db.transaction(['transactions', 'batches'], 'readwrite');
  const store = tx.objectStore('transactions');

  let added = 0;
  let refreshed = 0;
  for (const record of records) {
    const existing = await store.get(record.id);
    if (existing) {
      await store.put({ ...record, importBatchId: existing.importBatchId });
      refreshed++;
      continue;
    }
    await store.put(record);
    added++;
  }

  await tx.objectStore('batches').put({ ...batch, addedCount: added, refreshedCount: refreshed });
  await tx.done;
  return { added, refreshed };
}

export async function deleteBatch(batchId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['transactions', 'batches'], 'readwrite');
  const index = tx.objectStore('transactions').index('by-batch');
  let cursor = await index.openCursor(IDBKeyRange.only(batchId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.objectStore('batches').delete(batchId);
  await tx.done;
}

export async function getAllPackageBenefits(): Promise<PackageBenefitRecord[]> {
  const db = await getDB();
  return db.getAll('packageBenefits');
}

export async function getAllPackageBenefitBatches(): Promise<PackageBenefitBatch[]> {
  const db = await getDB();
  const batches = await db.getAll('packageBenefitBatches');
  return batches.sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
}

/**
 * A package-benefits file is a full snapshot "as on" one date, not incremental
 * transactional history - re-uploading the same date replaces every row for
 * that date rather than deduping/refreshing row by row.
 */
export async function addPackageBenefitSnapshot(
  batch: PackageBenefitBatch,
  records: PackageBenefitRecord[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['packageBenefits', 'packageBenefitBatches'], 'readwrite');
  const store = tx.objectStore('packageBenefits');
  const index = store.index('by-snapshot');

  let cursor = await index.openCursor(IDBKeyRange.only(batch.snapshotDate));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  for (const record of records) {
    await store.put(record);
  }

  await tx.objectStore('packageBenefitBatches').put(batch);
  await tx.done;
}

export async function deletePackageBenefitSnapshot(snapshotDate: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['packageBenefits', 'packageBenefitBatches'], 'readwrite');
  const index = tx.objectStore('packageBenefits').index('by-snapshot');
  let cursor = await index.openCursor(IDBKeyRange.only(snapshotDate));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.objectStore('packageBenefitBatches').delete(snapshotDate);
  await tx.done;
}

export async function getAllPnlLines(): Promise<PnlLineRecord[]> {
  const db = await getDB();
  return db.getAll('pnlLines');
}

export async function getAllPnlBatches(): Promise<PnlImportBatch[]> {
  const db = await getDB();
  const batches = await db.getAll('pnlBatches');
  return batches.sort((a, b) => b.month.localeCompare(a.month));
}

/** A P&L file is a full statement for one month, not incremental data - re-uploading the same month replaces every line for that month rather than deduping/refreshing line by line. */
export async function addPnlBatch(batch: PnlImportBatch, records: PnlLineRecord[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['pnlLines', 'pnlBatches'], 'readwrite');
  const store = tx.objectStore('pnlLines');
  const index = store.index('by-month');

  let cursor = await index.openCursor(IDBKeyRange.only(batch.month));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  for (const record of records) {
    await store.put(record);
  }

  await tx.objectStore('pnlBatches').put(batch);
  await tx.done;
}

export async function deletePnlBatch(month: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['pnlLines', 'pnlBatches'], 'readwrite');
  const index = tx.objectStore('pnlLines').index('by-month');
  let cursor = await index.openCursor(IDBKeyRange.only(month));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.objectStore('pnlBatches').delete(month);
  await tx.done;
}

export async function clearAllPnl(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['pnlLines', 'pnlBatches'], 'readwrite');
  await tx.objectStore('pnlLines').clear();
  await tx.objectStore('pnlBatches').clear();
  await tx.done;
}

export async function clearAll(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['transactions', 'batches', 'packageBenefits', 'packageBenefitBatches', 'pnlLines', 'pnlBatches'],
    'readwrite',
  );
  await tx.objectStore('transactions').clear();
  await tx.objectStore('batches').clear();
  await tx.objectStore('packageBenefits').clear();
  await tx.objectStore('packageBenefitBatches').clear();
  await tx.objectStore('pnlLines').clear();
  await tx.objectStore('pnlBatches').clear();
  await tx.done;
}
