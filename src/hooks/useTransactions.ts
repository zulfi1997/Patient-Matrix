import { useCallback, useEffect, useState } from 'react';
import * as db from '../db/db';
import { readWorkbook, rowsToRecords, ImportSchemaError } from '../lib/excelParser';
import { hashString } from '../lib/hash';
import type { ImportBatch, ImportWarning, SaleRecord } from '../types';

export interface ImportResult {
  fileName: string;
  totalRows: number;
  added: number;
  refreshed: number;
  /** Rows from earlier imports removed because this file restates those dates (see db.addBatch). */
  superseded: number;
  skipped: number;
  warnings: ImportWarning[];
}

export function useTransactions() {
  const [records, setRecords] = useState<SaleRecord[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [r, b] = await Promise.all([db.getAllTransactions(), db.getAllBatches()]);
    setRecords(r);
    setBatches(b);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const importFile = useCallback(async (file: File): Promise<ImportResult> => {
    const buffer = await file.arrayBuffer();
    const { headerMap, rows } = await readWorkbook(buffer);

    const batchId = hashString(`${file.name}|${file.size}|${file.lastModified}`);
    const { records: parsed, warnings } = rowsToRecords(rows, headerMap, batchId);

    let dateRange: ImportBatch['dateRange'] = null;
    if (parsed.length > 0) {
      const dates = parsed.map((r) => r.date).sort();
      dateRange = { min: dates[0], max: dates[dates.length - 1] };
    }

    const batch: ImportBatch = {
      id: batchId,
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
      totalRows: rows.length,
      addedCount: 0,
      refreshedCount: 0,
      supersededCount: 0,
      skippedCount: warnings.length,
      dateRange,
    };

    const { added, refreshed, superseded } = await db.addBatch(batch, parsed);

    await refresh();

    return {
      fileName: file.name,
      totalRows: rows.length,
      added,
      refreshed,
      superseded,
      skipped: warnings.length,
      warnings,
    };
  }, [refresh]);

  const removeBatch = useCallback(
    async (batchId: string) => {
      await db.deleteBatch(batchId);
      await refresh();
    },
    [refresh],
  );

  const clearAllData = useCallback(async () => {
    await db.clearAllTransactions();
    await refresh();
  }, [refresh]);

  const removeTransactionsByIds = useCallback(
    async (ids: string[]) => {
      await db.removeTransactionsByIds(ids);
      await refresh();
    },
    [refresh],
  );

  return { records, batches, loading, importFile, removeBatch, clearAllData, removeTransactionsByIds, refresh };
}

export { ImportSchemaError };
