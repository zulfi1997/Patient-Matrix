import { useCallback, useEffect, useState } from 'react';
import * as db from '../db/db';
import { parseDocxBlocks } from '../lib/docxParser';
import { extractScorecardFromBlocks } from '../lib/offerLetterKpis';
import { hashString } from '../lib/hash';
import type { StaffScorecard } from '../types';

export function useStaffScorecards() {
  const [scorecards, setScorecards] = useState<StaffScorecard[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setScorecards(await db.getAllStaffScorecards());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const importOfferLetter = useCallback(
    async (file: File): Promise<StaffScorecard> => {
      const blocks = await parseDocxBlocks(file);
      const parsed = extractScorecardFromBlocks(blocks);
      if (parsed.kpis.length === 0) {
        throw new Error(
          `Could not find a KPI table in "${file.name}" - this parser looks for tables with a "KPI Metric / Target" header row, which may not match this document's format.`,
        );
      }
      const scorecard: StaffScorecard = {
        id: hashString(`${file.name}|${file.size}|${file.lastModified}`),
        employeeName: parsed.employeeName ?? file.name.replace(/\.docx$/i, ''),
        roleTitle: parsed.roleTitle ?? 'Unknown role',
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        kpis: parsed.kpis,
      };
      await db.addStaffScorecard(scorecard);
      await refresh();
      return scorecard;
    },
    [refresh],
  );

  const removeScorecard = useCallback(
    async (id: string) => {
      await db.deleteStaffScorecard(id);
      await refresh();
    },
    [refresh],
  );

  return { scorecards, loading, importOfferLetter, removeScorecard, refresh };
}
