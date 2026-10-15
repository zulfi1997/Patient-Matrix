import { useCallback, useEffect, useState } from 'react';
import * as db from '../db/db';
import { parsePackageBenefitWorkbook, PackageBenefitSchemaError, PackageBenefitSnapshotDateError } from '../lib/packageBenefitParser';
import type { PackageBenefitBatch, PackageBenefitRecord } from '../types';

export interface PackageBenefitImportResult {
  fileName: string;
  snapshotDate: string;
  rowCount: number;
}

export function usePackageBenefits() {
  const [packageBenefits, setPackageBenefits] = useState<PackageBenefitRecord[]>([]);
  const [packageBenefitBatches, setPackageBenefitBatches] = useState<PackageBenefitBatch[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [records, batches] = await Promise.all([db.getAllPackageBenefits(), db.getAllPackageBenefitBatches()]);
    setPackageBenefits(records);
    setPackageBenefitBatches(batches);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const importPackageBenefitFile = useCallback(
    async (file: File, { deferRefresh = false }: { deferRefresh?: boolean } = {}): Promise<PackageBenefitImportResult> => {
      const buffer = await file.arrayBuffer();
      const { snapshotDate, records } = await parsePackageBenefitWorkbook(buffer);

      const batch: PackageBenefitBatch = {
        snapshotDate,
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        rowCount: records.length,
      };

      await db.addPackageBenefitSnapshot(batch, records);
      if (!deferRefresh) await refresh();

      return { fileName: file.name, snapshotDate, rowCount: records.length };
    },
    [refresh],
  );

  /**
   * Several files in one go, reading the store back once at the end.
   *
   * Refreshing per file re-read every snapshot already stored and pushed it all through React, so
   * importing a month of dailies re-read the earlier days over and over - by the last file that is
   * the whole table, and the cost grows with the square of the number of files. One file at a time
   * still refreshes immediately, since there is nothing to amortize.
   */
  const importPackageBenefitFiles = useCallback(
    async (
      files: File[],
      /**
       * Called before each file. Reading the store back only at the end means nothing on screen
       * moves during a long run, which looks like a hang - so the caller is told where it is up to.
       */
      onProgress?: (done: number, total: number, fileName: string) => void,
    ): Promise<{ outcomes: PackageBenefitImportResult[]; errors: { fileName: string; error: unknown }[] }> => {
      const outcomes: PackageBenefitImportResult[] = [];
      const errors: { fileName: string; error: unknown }[] = [];
      try {
        for (const [i, file] of files.entries()) {
          onProgress?.(i, files.length, file.name);
          // Lets the browser paint the progress before the next file's parse takes the main thread.
          await new Promise((resolve) => setTimeout(resolve, 0));
          try {
            outcomes.push(await importPackageBenefitFile(file, { deferRefresh: true }));
          } catch (error) {
            errors.push({ fileName: file.name, error });
          }
        }
      } finally {
        onProgress?.(files.length, files.length, '');
        // Even if a file threw, the ones before it are already stored and must become visible.
        await refresh();
      }
      return { outcomes, errors };
    },
    [importPackageBenefitFile, refresh],
  );

  const clearAllPackageBenefits = useCallback(async () => {
    await db.clearAllPackageBenefits();
    await refresh();
  }, [refresh]);

  const removePackageBenefitSnapshot = useCallback(
    async (snapshotDate: string) => {
      await db.deletePackageBenefitSnapshot(snapshotDate);
      await refresh();
    },
    [refresh],
  );

  return {
    packageBenefits,
    packageBenefitBatches,
    loading,
    importPackageBenefitFile,
    importPackageBenefitFiles,
    removePackageBenefitSnapshot,
    clearAllPackageBenefits,
    refresh,
  };
}

export { PackageBenefitSchemaError, PackageBenefitSnapshotDateError };
