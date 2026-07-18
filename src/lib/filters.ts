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
