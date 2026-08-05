import { useCallback, useEffect, useState } from 'react';
import * as db from '../db/db';
import { CollectionPeriodError, CollectionSchemaError, parseCollectionsWorkbook } from '../lib/collectionsParser';
import type { CollectionImportBatch, CollectionRecord } from '../types';

export interface CollectionImportResult {
  fileName: string;
  periodStart: string;
  periodEnd: string;
  rowCount: number;
  superseded: number;
}

export function useCollections() {
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [collectionBatches, setCollectionBatches] = useState<CollectionImportBatch[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [records, batches] = await Promise.all([db.getAllCollections(), db.getAllCollectionBatches()]);
    setCollections(records);
    setCollectionBatches(batches);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const importCollectionFile = useCallback(
    async (file: File): Promise<CollectionImportResult> => {
      const buffer = await file.arrayBuffer();
      // The batch id is the period, so a re-upload of the same window lands on the same key and
      // replaces it rather than accumulating a second copy alongside.
      const probe = await parseCollectionsWorkbook(buffer, 'pending');
      const id = `${probe.periodStart}..${probe.periodEnd}`;
      const { records } = await parseCollectionsWorkbook(buffer, id);

      const batch: CollectionImportBatch = {
        id,
        periodStart: probe.periodStart,
        periodEnd: probe.periodEnd,
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        rowCount: records.length,
      };

      const { superseded } = await db.addCollectionBatch(batch, records);
      await refresh();

      return { fileName: file.name, periodStart: batch.periodStart, periodEnd: batch.periodEnd, rowCount: records.length, superseded };
    },
    [refresh],
  );

  const removeCollectionBatch = useCallback(
    async (id: string) => {
      await db.deleteCollectionBatch(id);
      await refresh();
    },
    [refresh],
  );

  return { collections, collectionBatches, loading, importCollectionFile, removeCollectionBatch, refresh };
}

export { CollectionSchemaError, CollectionPeriodError };
