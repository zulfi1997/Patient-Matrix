import type { ImportBatch, SaleRecord } from '../types';

export interface SupersededByBatch {
  /** The newer import whose date range re-covers these rows. */
  batchId: string;
  fileName: string;
  uploadedAt: string;
  dateRange: { min: string; max: string };
  rowCount: number;
  revenueImpact: number;
  redeemedImpact: number;
  /** Which earlier imports the superseded rows came from, largest contributor first. */
  fromBatches: { batchId: string; fileName: string; rowCount: number }[];
}

export interface SupersededRowsSummary {
  removeIds: string[];
  rowCount: number;
  revenueImpact: number;
  redeemedImpact: number;
  groups: SupersededByBatch[];
}

interface BatchScope {
  batch: ImportBatch;
  min: string;
  max: string;
  centers: Set<string>;
}

/**
 * Applies the same rule addBatch() enforces at import time (see db/db.ts) to data that is
 * already stored: a row is superseded when a *later* import re-covers its date and its center,
 * because a sales export is a full restatement of its date range rather than an incremental log.
 *
 * This is what retires rows that no newer import contains at all - an invoice voided or deleted
 * in Zenoti - which no row-to-row matching rule can ever catch, since there is no incoming row
 * to match against. It equally clears the double-counting left by two ingest paths deriving
 * different ids for the same physical line.
 *
 * Each batch's date range and center set are derived from the rows actually stored for it rather
 * than from batch.dateRange, so a batch whose rows were partly removed by hand is scoped to what
 * genuinely remains.
 */
export function findSupersededRows(records: SaleRecord[], batches: ImportBatch[]): SupersededRowsSummary {
  const byBatch = new Map<string, SaleRecord[]>();
  for (const r of records) {
    const list = byBatch.get(r.importBatchId);
    if (list) list.push(r);
    else byBatch.set(r.importBatchId, [r]);
  }

  const scopes: BatchScope[] = [];
  for (const batch of batches) {
    const rows = byBatch.get(batch.id);
    if (!rows || rows.length === 0) continue;
    let min = rows[0].date;
    let max = rows[0].date;
    const centers = new Set<string>();
    for (const r of rows) {
      if (r.date < min) min = r.date;
      if (r.date > max) max = r.date;
      centers.add(r.centerName);
    }
    scopes.push({ batch, min, max, centers });
  }

  const groupsById = new Map<string, SupersededByBatch>();
  const fromCounts = new Map<string, Map<string, number>>();
  const removeIds: string[] = [];
  let rowCount = 0;
  let revenueImpact = 0;
  let redeemedImpact = 0;

  const uploadedAtById = new Map(batches.map((b) => [b.id, b.uploadedAt]));

  for (const r of records) {
    const ownUploadedAt = uploadedAtById.get(r.importBatchId);
    if (ownUploadedAt === undefined) continue; // orphaned row with no surviving batch record

    // The newest later import that re-covers this row's date and center wins.
    let winner: BatchScope | null = null;
    for (const s of scopes) {
      if (s.batch.id === r.importBatchId) continue;
      if (s.batch.uploadedAt <= ownUploadedAt) continue;
      if (r.date < s.min || r.date > s.max) continue;
      if (!s.centers.has(r.centerName)) continue;
      if (!winner || s.batch.uploadedAt > winner.batch.uploadedAt) winner = s;
    }
    if (!winner) continue;

    removeIds.push(r.id);
    rowCount++;
    revenueImpact += r.amount;
    redeemedImpact += r.redeemedAmount;

    let group = groupsById.get(winner.batch.id);
    if (!group) {
      group = {
        batchId: winner.batch.id,
        fileName: winner.batch.fileName,
        uploadedAt: winner.batch.uploadedAt,
        dateRange: { min: winner.min, max: winner.max },
        rowCount: 0,
        revenueImpact: 0,
        redeemedImpact: 0,
        fromBatches: [],
      };
      groupsById.set(winner.batch.id, group);
      fromCounts.set(winner.batch.id, new Map());
    }
    group.rowCount++;
    group.revenueImpact += r.amount;
    group.redeemedImpact += r.redeemedAmount;

    const counts = fromCounts.get(winner.batch.id)!;
    counts.set(r.importBatchId, (counts.get(r.importBatchId) ?? 0) + 1);
  }

  const fileNameById = new Map(batches.map((b) => [b.id, b.fileName]));
  const groups = [...groupsById.values()];
  for (const g of groups) {
    g.fromBatches = [...fromCounts.get(g.batchId)!.entries()]
      .map(([batchId, count]) => ({ batchId, fileName: fileNameById.get(batchId) ?? '(removed import)', rowCount: count }))
      .sort((a, b) => b.rowCount - a.rowCount);
  }
  groups.sort((a, b) => b.rowCount - a.rowCount);

  return { removeIds, rowCount, revenueImpact, redeemedImpact, groups };
}
