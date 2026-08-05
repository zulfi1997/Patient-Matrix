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

  /** Raw "Discount Name" from the export, e.g. "Manual discount", "Campaign - Buy 1 get 1 Free", "Price adjusted". */
  discountName: string | null;
  /** Discount amount taken off this line's Price to arrive at Sales (Exc. Tax): Price - discountAmount = salesExcTax. */
  discountAmount: number;
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
  /**
   * Rows from earlier imports that this import replaced because it re-covers their date and
   * center (see addBatch in db/db.ts). Optional: batches imported before replace-on-import
   * existed won't have it, so read it as `?? 0`.
   */
  supersededCount?: number;
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

export type PnlSection = 'income' | 'cogs' | 'expense' | 'otherIncome' | 'otherExpense';

/**
 * One line item from a Zoho Books "Income Statement Segment Wise" export - a single account's
 * amount for one segment/class, for one month. `segment` is whatever code the export's column
 * header uses (e.g. "GEN", "HT", "DM", "BT") - new segments just show up automatically the first
 * time they appear in an uploaded file, no code change needed.
 */
export interface PnlLineRecord {
  id: string;
  month: string; // ISO yyyy-mm-01
  segment: string;
  section: PnlSection;
  /** The report's subcategory heading active when this line appeared (e.g. "Human Resource Expenses"), or null for lines sitting directly under a section. */
  group: string | null;
  description: string;
  amount: number;
}

export interface PnlImportBatch {
  /** ISO yyyy-mm-01 - also the primary key, one batch per month (re-uploading a month replaces it wholesale, like a Package Benefits snapshot). */
  month: string;
  fileName: string;
  uploadedAt: string; // ISO datetime
  segments: string[];
  lineCount: number;
}

/** One KPI row extracted from an uploaded offer letter's KPI table(s). */
export interface StaffScorecardKpi {
  category: string;
  metric: string;
  target: string;
  measurementMethod: string;
}

/** A staff member's KPI scorecard, parsed from an uploaded offer letter (.docx). */
export interface StaffScorecard {
  id: string;
  employeeName: string;
  roleTitle: string;
  fileName: string;
  uploadedAt: string; // ISO datetime
  kpis: StaffScorecardKpi[];
}

/**
 * A manually-logged value for a KPI that can't be computed from clinic sales data (leads, NPS,
 * partnerships, etc.) - scoped to one scorecard + metric + month, since these are typically
 * things the staff member personally did/logged (a lead they generated, an event they attended),
 * unlike the auto-computed KPIs which are measured against overall clinic performance.
 */
export interface ManualKpiEntry {
  /** `${scorecardId}|${metric}|${month}` */
  id: string;
  scorecardId: string;
  metric: string;
  month: string; // yyyy-mm
  value: number;
  note: string | null;
  updatedAt: string; // ISO datetime
}

/**
 * One payment line from a Zenoti "Collections" export - money actually received on an invoice,
 * as opposed to revenue recognized when the sale was made.
 *
 * There is no staff column here worth using: "Collected By" is the cashier who took the payment,
 * not whoever sold the service. Attribution to a provider therefore runs through the invoice
 * number, against the sales data (see lib/collections.ts).
 */
export interface CollectionRecord {
  id: string;
  importBatchId: string;
  /** ISO yyyy-mm-dd - when the money was received, not when the sale was made. */
  date: string;
  invoiceNo: string;
  patientId: string;
  patientName: string;
  centerName: string;
  /** Raw Payment Type, kept whole: the redemption variants carry the package/card identity after a separator. */
  paymentType: string;
  /** Normalized bucket the payment type falls into. */
  method: CollectionMethod;
  /** This payment alone. The export's "Total Paid" is a running total per invoice, so it must not be summed. */
  amount: number;
  taxCollected: number;
  invoiceStatus: string;
  collectedBy: string | null;
  comments: string | null;
}

/**
 * Card, Cash and bank transfers are new money. Package, gift-card and prepaid-card settlements are
 * not - the cash for those arrived when the package or card was bought, and counting it again on
 * redemption would book the same money twice.
 */
export type CollectionMethod = 'card' | 'cash' | 'bankTransfer' | 'other' | 'package' | 'giftCard' | 'prepaidCard';

export interface CollectionImportBatch {
  /** `${start}..${end}` of the period the report covers - also the primary key, so re-uploading a period replaces it wholesale. */
  id: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  uploadedAt: string; // ISO datetime
  rowCount: number;
}

/**
 * A manual instruction that one invoice's collections belong wholly to one provider.
 *
 * The escape hatch for a payment the sales data cannot attribute on its own - a refund whose
 * invoice carries no seller, or one split across people in a way the clinic knows is wrong.
 * Stated explicitly, it beats any rule the app could infer, so it wins outright and no split
 * happens.
 */
export interface CollectionAttributionOverride {
  id: string;
  invoiceNo: string;
  provider: string;
  note: string;
}
