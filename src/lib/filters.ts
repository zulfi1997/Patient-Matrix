import type { ItemType, SaleRecord } from '../types';

/** Item types excluded from patient/service analysis: financial instruments, not clinic visits or service sales. */
export const ANALYSIS_EXCLUDED_TYPES: ItemType[] = ['Pre-paid card', 'Gift card'];

export function toAnalysisRecords(records: SaleRecord[]): SaleRecord[] {
  return records.filter((r) => !ANALYSIS_EXCLUDED_TYPES.includes(r.itemType));
}
