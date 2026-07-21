import { useCallback, useEffect, useState } from 'react';
import * as db from '../db/db';
import type { ManualKpiEntry } from '../types';

function entryId(scorecardId: string, metric: string, month: string): string {
  return `${scorecardId}|${metric}|${month}`;
}

export function useManualKpiEntries() {
  const [entries, setEntries] = useState<ManualKpiEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setEntries(await db.getAllManualKpiEntries());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setManualKpiValue = useCallback(
    async (scorecardId: string, metric: string, month: string, value: number, note: string | null) => {
      const entry: ManualKpiEntry = {
        id: entryId(scorecardId, metric, month),
        scorecardId,
        metric,
        month,
        value,
        note,
        updatedAt: new Date().toISOString(),
      };
      await db.setManualKpiEntry(entry);
      await refresh();
    },
    [refresh],
  );

  return { entries, loading, setManualKpiValue, refresh };
}
