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
   * Sales (Exc. Tax) minus any portion redeemed from a previously sold package
   * (redeemedAmount). This is the primary revenue figure used across the
   * dashboard. Paying with a gift card or prepaid card still counts in full -
   * only a package's own sessions being consumed is excluded, since that
   * value was already recognized as revenue when the package itself was sold.
   */
  amount: number;
  /** Portion of this line's value redeemed from a previously sold package (0 unless `packageName` is set). */
  redeemedAmount: number;
  /** Normalized package name if this line's Payment Type starts with "Package", else null. */
  packageName: string | null;
  amountIncTax: number;
  tax: number;

  paymentType: string | null;
  staff: string | null;
  centerName: string;
  invoiceNotes: string | null;
  /** Outstanding balance not yet collected for this line (0 once paid). */
  dueAmount: number;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  uploadedAt: string; // ISO datetime
  totalRows: number;
  addedCount: number;
  /** Rows that already existed (by content id) and were refreshed with newly parsed values rather than added again. */
  refreshedCount: number;
  skippedCount: number;
  dateRange: { min: string; max: string } | null;
}

export interface ImportWarning {
  rowNumber: number;
  message: string;
}

/**
 * One row from a Zenoti "Package Benefits Detail" export - a point-in-time snapshot of a
 * previously-sold package's remaining sessions, "as on" a specific date. Not transactional
 * history: re-uploading the same "as on" date replaces that date's snapshot entirely.
 */
export interface PackageBenefitRecord {
  /** Content hash of snapshotDate + invoiceNo + benefitName, for dedup within one snapshot. */
  id: string;
  snapshotDate: string; // ISO yyyy-mm-dd, parsed from the report's "As on" date
  saleCenter: string;
  /** The original package-purchase invoice - used to resolve the patient via the sales data (this report has no Guest Code). */
  invoiceNo: string;
  packageCode: string | null;
  packageName: string;
  packageCategory: string;
  guestName: string;
  benefitType: string;
  benefitName: string;
  accruedQty: number;
  value: number;
  redeemedQty: number;
  redeemedValue: number;
  balanceQty: number;
  packageStatus: string;
}

export interface PackageBenefitBatch {
  /** The snapshot's "as on" date (ISO yyyy-mm-dd) - also the primary key, one snapshot per date. */
  snapshotDate: string;
  fileName: string;
  uploadedAt: string; // ISO datetime
  rowCount: number;
}
