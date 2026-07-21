import type { ImportBatch, SaleRecord } from '../types';

export interface StaleDuplicateLine {
  keepId: string;
  removeIds: string[];
  invoiceNo: string;
  serviceName: string;
  date: string;
  qty: number;
  keptAmount: number;
  keptStatus: string;
  removedRows: { id: string; amount: number; invoiceStatus: string; uploadedAt: string }[];
  removedAmountTotal: number;
}

/**
 * Finds sales lines that exist as more than one row for what should be the same real invoice
 * line - matching invoice + service + quantity + date, but with more than one distinct Invoice
 * Status among them (e.g. one row still "Open", another "Closed"). That status mix is the
 * signature of the same line being captured at two different points in its lifecycle by imports
 * that computed incompatible row IDs for it (see the stable-ID dedup key in excelParser.ts) -
 * not two legitimately repeated sessions of the same service on one invoice, which would
 * consistently share a single status, since status is a whole-invoice property.
 *
 * For each such group, keeps the row from the most recently imported batch (freshest data) and
 * flags the rest for removal.
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
    const distinctStatuses = new Set(group.map((r) => r.invoiceStatus));
    if (distinctStatuses.size < 2) continue; // same status throughout - a legitimate repeat, not a stale duplicate

    const sorted = [...group].sort((a, b) => {
      const aTime = uploadedAtByBatch.get(a.importBatchId) ?? '';
      const bTime = uploadedAtByBatch.get(b.importBatchId) ?? '';
      return bTime.localeCompare(aTime); // most recently uploaded first
    });
    const [kept, ...stale] = sorted;

    results.push({
      keepId: kept.id,
      removeIds: stale.map((r) => r.id),
      invoiceNo: kept.invoiceNo,
      serviceName: kept.serviceName,
      date: kept.date,
      qty: kept.qty,
      keptAmount: kept.amount,
      keptStatus: kept.invoiceStatus,
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
