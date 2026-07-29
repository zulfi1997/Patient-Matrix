import type { ImportBatch, SaleRecord } from '../types';
import { ANALYSIS_EXCLUDED_TYPES, hasFlaggedNote, hasVisitValue } from './filters';
import { isInRange, type DateRange } from './metrics';
import { findSupersededRows } from './supersededRows';

export interface ReconciliationStage {
  label: string;
  /** Rows removed at this stage (0 for the opening and closing rows of the waterfall). */
  rowsRemoved: number;
  /** Gross Sales (Exc. Tax) removed at this stage. */
  grossRemoved: number;
  /** Running row count and gross after this stage. */
  rows: number;
  gross: number;
  note: string;
  /** True when this stage is controlled by a toggle that is currently off, so it removes nothing. */
  inactive?: boolean;
}

export interface BatchContribution {
  batchId: string;
  fileName: string;
  uploadedAt: string;
  rows: number;
  gross: number;
  /** Rows here that a later import already restates - i.e. rows that should not be counted. */
  supersededRows: number;
  supersededGross: number;
}

export interface RevenueReconciliation {
  /** Gross Sales (Exc. Tax) of every stored row in the period, before any exclusion. */
  sourceRows: number;
  sourceGross: number;
  stages: ReconciliationStage[];
  /** What the KPIs end up showing. revenue + redeemed === final stage gross. */
  revenue: number;
  redeemed: number;
  finalRows: number;
  finalGross: number;
  /** Per-import contribution, biggest first. More than one entry over the same dates means double-counting. */
  contributions: BatchContribution[];
  supersededRows: number;
  supersededGross: number;
}

const sumGross = (rows: SaleRecord[]) => rows.reduce((s, r) => s + r.amount + r.redeemedAmount, 0);

/**
 * Reconstructs, for one period, how the raw stored rows become the Revenue and Redeemed Revenue
 * KPIs - every exclusion itemized, plus which imports the rows came from.
 *
 * Exists to answer "why doesn't this match the figure I computed from the source report?" without
 * guesswork: the waterfall pins the difference to a specific exclusion, and the per-import
 * breakdown exposes the other cause, two imports both covering the same dates so their rows are
 * counted twice. Takes the *raw* stored records (not the already-filtered set the dashboard
 * renders) so the opening figure is directly comparable to the source report.
 *
 * "Gross" throughout is Sales (Exc. Tax) as the source reports it, reconstructed as
 * amount + redeemedAmount, since excelParser splits that one source column into those two fields.
 */
export function computeRevenueReconciliation(
  rawRecords: SaleRecord[],
  batches: ImportBatch[],
  range: DateRange,
  opts: { excludeFlagged: boolean; excludeZeroValue: boolean },
): RevenueReconciliation {
  const inPeriod = rawRecords.filter((r) => isInRange(r.date, range));
  const sourceGross = sumGross(inPeriod);

  const stages: ReconciliationStage[] = [
    {
      label: 'All stored rows in this period',
      rowsRemoved: 0,
      grossRemoved: 0,
      rows: inPeriod.length,
      gross: sourceGross,
      note: 'Sales (Exc. Tax) across every row held for these dates, before any exclusion - compare this with the same total in your source report.',
    },
  ];

  let current = inPeriod;

  const cards = current.filter((r) => ANALYSIS_EXCLUDED_TYPES.includes(r.itemType));
  current = current.filter((r) => !ANALYSIS_EXCLUDED_TYPES.includes(r.itemType));
  stages.push({
    label: 'Less gift card & prepaid card purchases',
    rowsRemoved: cards.length,
    grossRemoved: sumGross(cards),
    rows: current.length,
    gross: sumGross(current),
    note: 'Selling a gift or prepaid card is not revenue yet - it is recognized when the card is later redeemed. Always excluded.',
  });

  const flagged = current.filter(hasFlaggedNote);
  if (opts.excludeFlagged) current = current.filter((r) => !hasFlaggedNote(r));
  stages.push({
    label: 'Less YB111-flagged rows',
    rowsRemoved: opts.excludeFlagged ? flagged.length : 0,
    grossRemoved: opts.excludeFlagged ? sumGross(flagged) : 0,
    rows: current.length,
    gross: sumGross(current),
    inactive: !opts.excludeFlagged,
    note: opts.excludeFlagged
      ? 'The "Exclude YB111" toggle is on, so these are removed.'
      : `The "Exclude YB111" toggle is off, so these stay counted (${flagged.length} row(s) here).`,
  });

  const zeroValue = current.filter((r) => !hasVisitValue(r));
  if (opts.excludeZeroValue) current = current.filter(hasVisitValue);
  stages.push({
    label: 'Less zero-value rows',
    rowsRemoved: opts.excludeZeroValue ? zeroValue.length : 0,
    grossRemoved: opts.excludeZeroValue ? sumGross(zeroValue) : 0,
    rows: current.length,
    gross: sumGross(current),
    inactive: !opts.excludeZeroValue,
    note: opts.excludeZeroValue
      ? 'The "Exclude zero-value" toggle is on, so complimentary/zero lines are removed.'
      : `The "Exclude zero-value" toggle is off, so these stay counted (${zeroValue.length} row(s) here).`,
  });

  const revenue = current.reduce((s, r) => s + r.amount, 0);
  const redeemed = current.reduce((s, r) => s + r.redeemedAmount, 0);

  // Per-import contribution, and how much of it a later import already restates.
  const superseded = findSupersededRows(rawRecords, batches);
  const supersededIds = new Set(superseded.removeIds);
  const byBatch = new Map<string, BatchContribution>();
  const fileNameById = new Map(batches.map((b) => [b.id, b.fileName]));
  const uploadedAtById = new Map(batches.map((b) => [b.id, b.uploadedAt]));
  for (const r of inPeriod) {
    let c = byBatch.get(r.importBatchId);
    if (!c) {
      c = {
        batchId: r.importBatchId,
        fileName: fileNameById.get(r.importBatchId) ?? '(import no longer listed)',
        uploadedAt: uploadedAtById.get(r.importBatchId) ?? '',
        rows: 0,
        gross: 0,
        supersededRows: 0,
        supersededGross: 0,
      };
      byBatch.set(r.importBatchId, c);
    }
    const gross = r.amount + r.redeemedAmount;
    c.rows++;
    c.gross += gross;
    if (supersededIds.has(r.id)) {
      c.supersededRows++;
      c.supersededGross += gross;
    }
  }
  const contributions = [...byBatch.values()].sort((a, b) => b.rows - a.rows);

  const supersededInPeriod = inPeriod.filter((r) => supersededIds.has(r.id));

  return {
    sourceRows: inPeriod.length,
    sourceGross,
    stages,
    revenue,
    redeemed,
    finalRows: current.length,
    finalGross: revenue + redeemed,
    contributions,
    supersededRows: supersededInPeriod.length,
    supersededGross: sumGross(supersededInPeriod),
  };
}
