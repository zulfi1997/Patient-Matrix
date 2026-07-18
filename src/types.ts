export type ItemType =
  | 'Service'
  | 'Package'
  | 'Product'
  | 'Pre-paid card'
  | 'Gift card'
  | string;

/** One line item from a Zenoti sales export. */
export interface SaleRecord {
  /** Stable content hash used to dedupe re-uploaded/overlapping exports. */
  id: string;
  importBatchId: string;

  patientId: string;
  patientName: string;

  /** ISO yyyy-mm-dd */
  date: string;

  itemType: ItemType;
  /** Grouping key for "service" analytics: Item Code when present, else a bucket for custom/unc coded items. */
  serviceKey: string;
  serviceName: string;
  subcategory: string;

  qty: number;
  invoiceNo: string;
  invoiceStatus: string;

  /** Sales (Exc. Tax) - the primary revenue figure used across the dashboard. */
  amount: number;
  amountIncTax: number;
  tax: number;

  paymentType: string | null;
  staff: string | null;
  centerName: string;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  uploadedAt: string; // ISO datetime
  totalRows: number;
  addedCount: number;
  duplicateCount: number;
  skippedCount: number;
  dateRange: { min: string; max: string } | null;
}

export interface ImportWarning {
  rowNumber: number;
  message: string;
}
