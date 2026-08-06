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
    async (file: File): Promise<PackageBenefitImportResult> => {
      const buffer = await file.arrayBuffer();
      const { snapshotDate, records } = await parsePackageBenefitWorkbook(buffer);

      const batch: PackageBenefitBatch = {
        snapshotDate,
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        rowCount: records.length,
      };

      await db.addPackageBenefitSnapshot(batch, records);
      await refresh();

      return { fileName: file.name, snapshotDate, rowCount: records.length };
    },
    [refresh],
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
    removePackageBenefitSnapshot,
    clearAllPackageBenefits,
    refresh,
  };
}

export { PackageBenefitSchemaError, PackageBenefitSnapshotDateError };
