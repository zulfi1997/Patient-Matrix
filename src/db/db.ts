import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ImportBatch, SaleRecord } from '../types';

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
}

const DB_NAME = 'patient-matrix';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<PatientMatrixDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<PatientMatrixDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const tx = db.createObjectStore('transactions', { keyPath: 'id' });
        tx.createIndex('by-batch', 'importBatchId');
        tx.createIndex('by-patient', 'patientId');
        db.createObjectStore('batches', { keyPath: 'id' });
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

export async function clearAll(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['transactions', 'batches'], 'readwrite');
  await tx.objectStore('transactions').clear();
  await tx.objectStore('batches').clear();
  await tx.done;
}
