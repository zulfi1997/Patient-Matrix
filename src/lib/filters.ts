import type { ItemType, SaleRecord } from '../types';

/** Item types excluded from patient/service analysis: financial instruments, not clinic visits or service sales. */
export const ANALYSIS_EXCLUDED_TYPES: ItemType[] = ['Pre-paid card', 'Gift card'];

export function toAnalysisRecords(records: SaleRecord[]): SaleRecord[] {
  return records.filter((r) => !ANALYSIS_EXCLUDED_TYPES.includes(r.itemType));
}

/** Matches "YB111" anywhere in Invoice Notes, case-insensitive (also catches variants like "YB1111"). */
export function hasFlaggedNote(record: SaleRecord): boolean {
  return !!record.invoiceNotes && record.invoiceNotes.toLowerCase().includes('yb111');
}

export function excludeFlaggedRecords(records: SaleRecord[]): SaleRecord[] {
  return records.filter((r) => !hasFlaggedNote(r));
}

/**
 * True unless this line item is exactly zero on both amount and redeemedAmount - i.e. a
 * genuinely free/complimentary line (no charge, no package behind it), which shouldn't count
 * as a "visit" for retention purposes. Deliberately not "> 0": a negative amount (a refund,
 * discount, or correction) still has real financial substance and must stay counted - only
 * exact-zero-on-both is "nothing happened here".
 */
export function hasVisitValue(record: SaleRecord): boolean {
  return record.amount !== 0 || record.redeemedAmount !== 0;
}

export function excludeZeroValueRecords(records: SaleRecord[]): SaleRecord[] {
  return records.filter(hasVisitValue);
}
