import type { ZenotiRawSaleRow } from './fetchSales.d.mts';

/** Column names/shape matching what src/lib/excelParser.ts expects from a manual Zenoti sales export. */
export type ZenotiExportRow = Record<string, unknown>;

export function zenotiRowToExportRow(row: ZenotiRawSaleRow): ZenotiExportRow;
export function zenotiRowsToExportRows(rows: ZenotiRawSaleRow[]): ZenotiExportRow[];
