import type { ImportBatch, SaleRecord } from '../types';

export interface StaleDuplicateLine {
  invoiceNo: string;
  serviceName: string;
  date: string;
  qty: number;
  keepIds: string[];
  keptAmountTotal: number;
  keptStatus: string;
  removeIds: string[];
  removedRows: { id: string; amount: number; invoiceStatus: string; uploadedAt: string }[];
  removedAmountTotal: number;
}

/**
 * Finds sales lines that exist as more than one row for what should be the same real invoice
 * line - matched on invoice + service + quantity + date together (an invoice can legitimately
 * carry several different services, so invoice number alone isn't a safe match key) - captured
 * by more than one import batch. Landing in more than one batch is the signature of the same
 * line being ingested twice under incompatible row IDs (e.g. once from a manually-uploaded
 * export using a derived hash ID, once from the Zenoti API sync using its stable "Invoice Item
 * ID" - see excelParser.ts), not two legitimately repeated sessions of the same service on one
 * invoice, which would all land in the *same* batch (one file, captured once).
 *
 * Keeps every row from whichever matched batch was uploaded most recently (so if that batch
 * legitimately captured N repeated sessions of this exact line, all N are kept) and flags every
 * row from older batches as the stale duplicate to remove.
 */
export function findStaleDuplicateInvoiceLines(records: SaleRecord[], batches: ImportBatch[]): StaleDuplicateLine[] {
  const uploadedAtByBatch = new Map(batches.map((b) => [b.id, b.uploadedAt]));
  const groups = new Map<string, SaleRecord[]>();

  for (const r of records) {
    const key = [r.invoiceNo, r.serviceKey, r.qty, r.date].join('|');
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const results: StaleDuplicateLine[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const distinctBatchIds = new Set(group.map((r) => r.importBatchId));
    if (distinctBatchIds.size < 2) continue; // same import batch throughout - a legitimate repeat, not a stale duplicate

    let latestBatchId = group[0].importBatchId;
    let latestTime = uploadedAtByBatch.get(latestBatchId) ?? '';
    for (const batchId of distinctBatchIds) {
      const t = uploadedAtByBatch.get(batchId) ?? '';
      if (t > latestTime) {
        latestTime = t;
        latestBatchId = batchId;
      }
    }

    const kept = group.filter((r) => r.importBatchId === latestBatchId);
    const stale = group.filter((r) => r.importBatchId !== latestBatchId);

    results.push({
      invoiceNo: group[0].invoiceNo,
      serviceName: group[0].serviceName,
      date: group[0].date,
      qty: group[0].qty,
      keepIds: kept.map((r) => r.id),
      keptAmountTotal: kept.reduce((sum, r) => sum + r.amount, 0),
      keptStatus: kept[0].invoiceStatus,
      removeIds: stale.map((r) => r.id),
      removedRows: stale.map((r) => ({
        id: r.id,
        amount: r.amount,
        invoiceStatus: r.invoiceStatus,
        uploadedAt: uploadedAtByBatch.get(r.importBatchId) ?? '',
      })),
      removedAmountTotal: stale.reduce((sum, r) => sum + r.amount, 0),
    });
  }

  return results.sort((a, b) => b.removedAmountTotal - a.removedAmountTotal);
}
