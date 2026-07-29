import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  ImportBatch,
  ManualKpiEntry,
  PackageBenefitBatch,
  PackageBenefitRecord,
  PnlImportBatch,
  PnlLineRecord,
  SaleRecord,
  StaffScorecard,
} from '../types';
import type { DepartmentMappingBatch, ServiceDepartmentRecord } from '../lib/departments';

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
  staffScorecards: {
    key: string;
    value: StaffScorecard;
  };
  manualKpiEntries: {
    key: string;
    value: ManualKpiEntry;
    indexes: { 'by-scorecard': string };
  };
  serviceDepartments: {
    key: string;
    value: ServiceDepartmentRecord;
  };
  /** Info about the last mapping file import - a single record (key 'current'), since the file replaces the whole mapping wholesale. */
  departmentMappingBatch: {
    key: string;
    value: DepartmentMappingBatch;
  };
}

const DB_NAME = 'patient-matrix';
const DB_VERSION = 6;

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
        if (oldVersion < 4) {
          db.createObjectStore('staffScorecards', { keyPath: 'id' });
        }
        if (oldVersion < 5) {
          const manual = db.createObjectStore('manualKpiEntries', { keyPath: 'id' });
          manual.createIndex('by-scorecard', 'scorecardId');
        }
        if (oldVersion < 6) {
          db.createObjectStore('serviceDepartments', { keyPath: 'serviceKey' });
          db.createObjectStore('departmentMappingBatch');
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
 * Adds transactions, treating the import as authoritative for every day it covers: any row from
 * an earlier import that falls inside this import's date range (and belongs to a center this
 * import also covers) is deleted first, then this import's rows are written.
 *
 * A sales export is a full restatement of its date range, not an incremental log, so
 * last-import-wins is the only semantics that stays correct over repeated syncs. Row-by-row
 * dedup cannot get there, for two reasons:
 *
 *  - The two ingest paths derive incompatible row ids for the same physical line (a manual
 *    export uses a content hash; the Zenoti API sync uses its stable "Invoice Item ID" - see
 *    excelParser.ts), so overlapping imports double-count instead of deduping.
 *  - An invoice voided or deleted in Zenoti simply isn't in the newer export. There is no
 *    incoming row to match it against, so no row-level rule can ever retire it; only clearing
 *    the day and rewriting it from the newer export does.
 *
 * This mirrors how addPnlBatch and addPackageBenefitSnapshot already treat a period's file as a
 * wholesale replacement.
 *
 * Replacement is scoped to the centers present in this import, so a single-center export never
 * silently wipes another center's rows for those same days. Rows already belonging to this
 * batch id (a straight re-upload of the same file) are refreshed in place rather than deleted
 * and re-added, so re-importing after an app update still heals stored values.
 *
 * Caveat worth knowing: because the range comes from the file's own min/max row dates, a
 * deliberately *partial* export spanning a wide range (e.g. filtered to one item type) will
 * supersede the fuller data it overlaps. The superseded count is reported per import so this is
 * visible rather than silent.
 */
export async function addBatch(
  batch: ImportBatch,
  records: SaleRecord[],
): Promise<{ added: number; refreshed: number; superseded: number }> {
  const db = await getDB();
  const tx = db.transaction(['transactions', 'batches'], 'readwrite');
  const store = tx.objectStore('transactions');

  let superseded = 0;
  if (batch.dateRange && records.length > 0) {
    const { min, max } = batch.dateRange;
    const centers = new Set(records.map((r) => r.centerName));
    let cursor = await store.openCursor();
    while (cursor) {
      const existing = cursor.value;
      if (
        existing.importBatchId !== batch.id &&
        existing.date >= min &&
        existing.date <= max &&
        centers.has(existing.centerName)
      ) {
        await cursor.delete();
        superseded++;
      }
      cursor = await cursor.continue();
    }
  }

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

  await tx
    .objectStore('batches')
    .put({ ...batch, addedCount: added, refreshedCount: refreshed, supersededCount: superseded });
  await tx.done;
  return { added, refreshed, superseded };
}

/** Deletes specific transaction rows by id, leaving the rest of their batch (and everything else) untouched. */
export async function removeTransactionsByIds(ids: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('transactions', 'readwrite');
  await Promise.all(ids.map((id) => tx.objectStore('transactions').delete(id)));
  await tx.done;
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

export async function clearAllTransactions(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['transactions', 'batches'], 'readwrite');
  await tx.objectStore('transactions').clear();
  await tx.objectStore('batches').clear();
  await tx.done;
}

export async function getAllStaffScorecards(): Promise<StaffScorecard[]> {
  const db = await getDB();
  const all = await db.getAll('staffScorecards');
  return all.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function addStaffScorecard(scorecard: StaffScorecard): Promise<void> {
  const db = await getDB();
  await db.put('staffScorecards', scorecard);
}

export async function deleteStaffScorecard(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('staffScorecards', id);
  const tx = db.transaction('manualKpiEntries', 'readwrite');
  const index = tx.objectStore('manualKpiEntries').index('by-scorecard');
  let cursor = await index.openCursor(IDBKeyRange.only(id));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function getAllManualKpiEntries(): Promise<ManualKpiEntry[]> {
  const db = await getDB();
  return db.getAll('manualKpiEntries');
}

export async function setManualKpiEntry(entry: ManualKpiEntry): Promise<void> {
  const db = await getDB();
  await db.put('manualKpiEntries', entry);
}

export async function getAllServiceDepartments(): Promise<ServiceDepartmentRecord[]> {
  const db = await getDB();
  return db.getAll('serviceDepartments');
}

export async function setServiceDepartment(record: ServiceDepartmentRecord): Promise<void> {
  const db = await getDB();
  await db.put('serviceDepartments', record);
}

export async function deleteServiceDepartment(serviceKey: string): Promise<void> {
  const db = await getDB();
  await db.delete('serviceDepartments', serviceKey);
}

/** Replaces the entire mapping wholesale with what's in the uploaded file, same as a Package Benefits snapshot replace. */
export async function importServiceDepartmentBatch(batch: DepartmentMappingBatch, records: ServiceDepartmentRecord[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['serviceDepartments', 'departmentMappingBatch'], 'readwrite');
  await tx.objectStore('serviceDepartments').clear();
  for (const record of records) {
    await tx.objectStore('serviceDepartments').put(record);
  }
  await tx.objectStore('departmentMappingBatch').put(batch, 'current');
  await tx.done;
}

export async function getDepartmentMappingBatch(): Promise<DepartmentMappingBatch | null> {
  const db = await getDB();
  return (await db.get('departmentMappingBatch', 'current')) ?? null;
}
