import type { ImportWarning, ItemType, SaleRecord } from '../types';
import { hashString } from './hash';

/**
 * Column headers as they appear in the clinic's Zenoti "sales" export.
 * Matching is case-insensitive and whitespace-tolerant so minor export
 * differences (extra spaces, casing) don't break the import.
 */
const REQUIRED_HEADERS = [
  'Sale Date',
  'Guest Code',
  'Guest Name',
  'Item Type',
  'Item Name',
  'Invoice No',
  'Sales (Exc. Tax)',
] as const;

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface ParsedSheet {
  headerMap: Map<string, string>; // normalized -> original header found in file
  rows: Record<string, unknown>[];
}

export class ImportSchemaError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`Missing required column(s): ${missing.join(', ')}`);
    this.missing = missing;
  }
}

export async function readWorkbook(buffer: ArrayBuffer): Promise<ParsedSheet> {
  // Loaded lazily so the (large) xlsx library only ships to the browser
  // when someone actually imports a file, not on initial page load.
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });

  const headerMap = new Map<string, string>();
  if (rows.length > 0) {
    for (const key of Object.keys(rows[0])) {
      headerMap.set(normalizeHeader(key), key);
    }
  }

  const missing = REQUIRED_HEADERS.filter((h) => !headerMap.has(normalizeHeader(h)));
  if (missing.length > 0) {
    throw new ImportSchemaError(missing);
  }

  return { headerMap, rows };
}

function get(row: Record<string, unknown>, headerMap: Map<string, string>, name: string): unknown {
  const original = headerMap.get(normalizeHeader(name));
  if (!original) return null;
  return row[original];
}

/** Parses "M/D/YYYY" (the format used by this export), Excel date serials, or Date objects. */
function parseSaleDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toISODate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number') {
    // Excel serial date: days since 1899-12-30 (epoch offset 25569 = 1970-01-01).
    const utcDays = Math.floor(value - 25569);
    const d = new Date(utcDays * 86_400_000);
    return toISODate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const str = String(value).trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
  if (m) {
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    return toISODate(year, month, day);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function toISODate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseNumber(value: unknown): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

const PACKAGE_CATEGORY_ALIASES: Record<string, string> = {
  iv: 'IV',
  lhr: 'LHR',
  derma: 'Derma',
  wellness: 'Wellness',
  wellnes: 'Wellness',
  welness: 'Wellness',
};

/**
 * Extracts a stable, human-readable package name from a "Package - ..."
 * Payment Type value. Catalog packages look like "Package - LHR Beard Half
 * (3 Sessions) - Original"; custom packages embed the patient's name and a
 * timestamp (e.g. "Package - derma-Custom Package-Amal-20250324152258"),
 * which are collapsed to a stable "<Category> Custom Package" label so they
 * aggregate together instead of each becoming a one-off "package".
 */
function extractPackageName(paymentType: string): string {
  let s = paymentType.trim().replace(/^package\s*-?\s*/i, '');

  const customMatch = /^(.*?)custom package/i.exec(s);
  if (customMatch) {
    const prefix = customMatch[1].replace(/[-\s]+$/, '').trim();
    if (!prefix) return 'Custom Package';
    const lower = prefix.toLowerCase();
    const alias = PACKAGE_CATEGORY_ALIASES[lower];
    return `${alias ?? lower.charAt(0).toUpperCase() + lower.slice(1)} Custom Package`;
  }

  s = s.replace(/\s*-\s*original\s*$/i, '');
  return s.trim() || 'Package';
}

function serviceGroupKey(itemType: ItemType, itemCode: unknown): string {
  if (itemCode != null && String(itemCode).trim() !== '') {
    return `code:${String(itemCode).trim()}`;
  }
  // Custom packages / prepaid cards / gift cards typically have no stable
  // item code and unique, one-off names (often embedding a patient name
  // and timestamp) - bucket them by type so they aggregate sensibly
  // instead of each becoming a "service" that only ever sold once.
  return `type:${itemType}`;
}

export interface ParseOutcome {
  records: SaleRecord[];
  warnings: ImportWarning[];
}

/** Converts validated raw rows into SaleRecords, skipping and reporting invalid rows. */
export function rowsToRecords(
  rows: Record<string, unknown>[],
  headerMap: Map<string, string>,
  importBatchId: string,
): ParseOutcome {
  const records: SaleRecord[] = [];
  const warnings: ImportWarning[] = [];
  const occurrence = new Map<string, number>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // account for header row, 1-indexed

    const invoiceNo = String(get(row, headerMap, 'Invoice No') ?? '').trim();
    const patientId = String(get(row, headerMap, 'Guest Code') ?? '').trim();
    const date = parseSaleDate(get(row, headerMap, 'Sale Date'));
    const itemName = String(get(row, headerMap, 'Item Name') ?? '').trim();
    const itemType = String(get(row, headerMap, 'Item Type') ?? '').trim() as ItemType;

    if (!invoiceNo || !patientId || !date || !itemName) {
      warnings.push({
        rowNumber,
        message: `Skipped: missing ${[
          !invoiceNo && 'Invoice No',
          !patientId && 'Guest Code',
          !date && 'Sale Date',
          !itemName && 'Item Name',
        ]
          .filter(Boolean)
          .join(', ')}`,
      });
      return;
    }

    const itemCode = get(row, headerMap, 'Item Code');
    const serviceKey = serviceGroupKey(itemType, itemCode);

    // Dedup key: same invoice + same line item content should be treated as
    // the same physical transaction line across repeated/overlapping
    // uploads. An occurrence counter distinguishes genuine repeats of the
    // identical item within one invoice (e.g. two sessions of the same
    // service billed on one invoice).
    const baseKey = [invoiceNo, serviceKey, itemName, get(row, headerMap, 'Qty'), get(row, headerMap, 'Sales (Exc. Tax)')].join('|');
    const occCount = (occurrence.get(baseKey) ?? 0) + 1;
    occurrence.set(baseKey, occCount);
    const id = hashString(`${baseKey}|${occCount}`);

    const salesExcTax = parseNumber(get(row, headerMap, 'Sales (Exc. Tax)'));
    const excRedemptionRaw = get(row, headerMap, 'Sales (Exc. Redemption)');
    // Only fall back to Sales (Exc. Tax) when the column is genuinely absent from this export -
    // a present-but-zero value (fully paid via redemption) must be kept as 0, not overwritten.
    const amount = excRedemptionRaw != null ? parseNumber(excRedemptionRaw) : salesExcTax;
    const amountIncTax = parseNumber(get(row, headerMap, 'Sales(Inc. Tax)')) || salesExcTax;
    const tax = parseNumber(get(row, headerMap, 'Tax'));
    const qty = parseNumber(get(row, headerMap, 'Qty')) || 1;

    const paymentType = (get(row, headerMap, 'Payment Type') as string) || null;
    // "Redeemed Revenue" is scoped specifically to package redemptions (Payment
    // Type starting with "Package") rather than the broader Redeemed column,
    // which also covers prepaid-card/gift-card redemptions.
    const isPackageRedemption = !!paymentType && paymentType.trim().toLowerCase().startsWith('package');
    const packageName = isPackageRedemption ? extractPackageName(paymentType!) : null;
    const redeemedAmount = isPackageRedemption ? parseNumber(get(row, headerMap, 'Redeemed')) : 0;

    records.push({
      id,
      importBatchId,
      patientId,
      patientName: String(get(row, headerMap, 'Guest Name') ?? '').trim() || patientId,
      date,
      itemType,
      serviceKey,
      serviceName: itemName,
      subcategory: String(get(row, headerMap, 'Item Subcategory') ?? '').trim() || 'Not Specified',
      qty,
      invoiceNo,
      invoiceStatus: String(get(row, headerMap, 'Invoice status') ?? '').trim() || 'Unknown',
      amount,
      redeemedAmount,
      packageName,
      amountIncTax,
      tax,
      paymentType,
      staff: (get(row, headerMap, 'Sold By') as string) || (get(row, headerMap, 'Therapist') as string) || null,
      centerName: String(get(row, headerMap, 'Center Name') ?? '').trim() || 'Default',
    });
  });

  return { records, warnings };
}
