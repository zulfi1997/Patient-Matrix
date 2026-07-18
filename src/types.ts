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

  /**
   * Sales (Exc. Redemption) - net new revenue for this line, excluding any
   * portion paid by redeeming a previously purchased package/prepaid/gift
   * card. This is the primary revenue figure used across the dashboard, so
   * a package's value isn't counted again each time a session from it is
   * used. Falls back to Sales (Exc. Tax) if the export lacks that column.
   */
  amount: number;
  /** Portion of this line's value paid via redemption (see `amount`), tracked separately so it isn't silently dropped. */
  redeemedAmount: number;
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
