import type { ImportBatch, SaleRecord } from '../types';

let seq = 0;

/**
 * A minimal valid SaleRecord. Every field a test doesn't care about gets a neutral value, so each
 * test only states the fields that matter to what it's asserting.
 */
export function makeSale(overrides: Partial<SaleRecord> = {}): SaleRecord {
  seq += 1;
  return {
    id: `row-${seq}`,
    importBatchId: 'batch-1',
    patientId: 'MUS1',
    patientName: 'Test Patient',
    date: '2026-07-10',
    itemType: 'Service',
    serviceKey: 'code:SVC',
    serviceName: 'Some Service',
    subcategory: 'General',
    qty: 1,
    invoiceNo: 'INV-1',
    invoiceStatus: 'Closed',
    amount: 0,
    redeemedAmount: 0,
    packageName: null,
    amountIncTax: 0,
    tax: 0,
    paymentType: 'Cash',
    staff: null,
    centerName: 'Main',
    invoiceNotes: null,
    dueAmount: 0,
    discountName: null,
    discountAmount: 0,
    ...overrides,
  };
}

export function makeBatch(overrides: Partial<ImportBatch> & Pick<ImportBatch, 'id' | 'uploadedAt'>): ImportBatch {
  return {
    fileName: `${overrides.id}.xlsx`,
    totalRows: 0,
    addedCount: 0,
    refreshedCount: 0,
    skippedCount: 0,
    dateRange: null,
    ...overrides,
  };
}

/** Builds the header map excelParser expects, from the union of keys across the given rows. */
export function headerMapFor(rows: Record<string, unknown>[]): Map<string, string> {
  const merged: Record<string, unknown> = {};
  for (const r of rows) Object.assign(merged, r);
  const map = new Map<string, string>();
  for (const key of Object.keys(merged)) {
    map.set(key.trim().toLowerCase().replace(/\s+/g, ' '), key);
  }
  return map;
}
