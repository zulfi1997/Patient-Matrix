import { useCallback, useEffect, useState } from 'react';
import * as db from '../db/db';
import { parsePnlWorkbook, PnlDateRangeError, PnlSchemaError, type PnlReportedTotals } from '../lib/pnlParser';
import type { PnlImportBatch, PnlLineRecord } from '../types';

export interface PnlImportResult {
  fileName: string;
  month: string;
  segments: string[];
  lineCount: number;
  reportedTotals: Map<string, PnlReportedTotals>;
}

export function usePnl() {
  const [pnlLines, setPnlLines] = useState<PnlLineRecord[]>([]);
  const [pnlBatches, setPnlBatches] = useState<PnlImportBatch[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [lines, batches] = await Promise.all([db.getAllPnlLines(), db.getAllPnlBatches()]);
    setPnlLines(lines);
    setPnlBatches(batches);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const importPnlFile = useCallback(
    async (file: File): Promise<PnlImportResult> => {
      const html = await file.text();
      const { month, segments, records, reportedTotals } = parsePnlWorkbook(html);

      const batch: PnlImportBatch = {
        month,
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        segments,
        lineCount: records.length,
      };

      await db.addPnlBatch(batch, records);
      await refresh();

      return { fileName: file.name, month, segments, lineCount: records.length, reportedTotals };
    },
    [refresh],
  );

  const removePnlBatch = useCallback(
    async (month: string) => {
      await db.deletePnlBatch(month);
      await refresh();
    },
    [refresh],
  );

  return { pnlLines, pnlBatches, loading, importPnlFile, removePnlBatch, refresh };
}

export { PnlSchemaError, PnlDateRangeError };
