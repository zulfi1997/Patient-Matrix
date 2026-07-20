import type { PnlImportBatch, PnlLineRecord, PnlSection } from '../types';

/** The segment code carrying shared/general overhead, allocated out to every other segment - never has its own row in the output. */
export const GENERAL_SEGMENT = 'GEN';

const SECTION_ORDER: PnlSection[] = ['income', 'cogs', 'expense', 'otherIncome', 'otherExpense'];
export const SECTION_LABELS: Record<PnlSection, string> = {
  income: 'INCOME',
  cogs: 'COST OF GOODS SOLD',
  expense: 'EXPENSE',
  otherIncome: 'OTHER INCOME',
  otherExpense: 'OTHER EXPENSE',
};

/**
 * A configured share of GEN's costs allocated to `segment`, effective from a given month onward
 * until superseded by a later rule for the same segment - "this percentage can change time to
 * time" without rewriting history, mirroring the date-scoped Provider Assignment Overrides
 * already used elsewhere in this app.
 */
export interface SegmentAllocationRule {
  id: string;
  effectiveFrom: string; // ISO yyyy-mm-01
  segment: string;
  percent: number; // 0-100
}

/** The % of GEN's costs allocated to `segment` for `month`: the rule for that segment with the latest effectiveFrom <= month (0 if none configured yet). */
export function resolveAllocationPercent(rules: SegmentAllocationRule[], segment: string, month: string): number {
  let best: SegmentAllocationRule | null = null;
  for (const r of rules) {
    if (r.segment !== segment || r.effectiveFrom > month) continue;
    if (!best || r.effectiveFrom > best.effectiveFrom) best = r;
  }
  return best?.percent ?? 0;
}

/** Sum of every segment's active allocation % as of `month` - should be 100 if GEN's costs are meant to be fully distributed; under/over 100 leaves a residual under/over-allocated. */
export function totalAllocatedPercent(rules: SegmentAllocationRule[], segments: string[], month: string): number {
  return segments
    .filter((s) => s !== GENERAL_SEGMENT)
    .reduce((sum, s) => sum + resolveAllocationPercent(rules, s, month), 0);
}

/** Whether GEN's overhead is split by a manually configured %, or dynamically by each segment's share of that month's own Revenue. */
export type AllocationMode = 'percentage' | 'revenue';

/** Each target segment's own Revenue (INCOME section) for `month`, 0 for a segment with none. */
function computeMonthlyRevenue(records: PnlLineRecord[], month: string, targetSegments: string[]): Map<string, number> {
  const revenue = new Map(targetSegments.map((s) => [s, 0]));
  for (const r of records) {
    if (r.month !== month || r.section !== 'income' || !revenue.has(r.segment)) continue;
    revenue.set(r.segment, (revenue.get(r.segment) ?? 0) + r.amount);
  }
  return revenue;
}

/**
 * The % of GEN's costs allocated to `segment` for `month`, under either mode: the configured
 * rule (percentage mode), or that segment's share of the target segments' combined Revenue for
 * that same month (revenue mode) - so a segment that brought in more revenue that month absorbs
 * a proportionally larger share of overhead. Revenue mode is 0% for every segment in a month
 * where none of the target segments had any revenue (nothing to apportion by).
 */
export function resolveMonthlyAllocationPercent(
  records: PnlLineRecord[],
  mode: AllocationMode,
  rules: SegmentAllocationRule[],
  segment: string,
  month: string,
  targetSegments: string[],
): number {
  if (mode === 'percentage') return resolveAllocationPercent(rules, segment, month);
  const revenue = computeMonthlyRevenue(records, month, targetSegments);
  const total = [...revenue.values()].reduce((sum, v) => sum + v, 0);
  if (total <= 0) return 0;
  return ((revenue.get(segment) ?? 0) / total) * 100;
}

export interface PnlLineKey {
  section: PnlSection;
  group: string | null;
  description: string;
}

export interface SegmentPnlLine extends PnlLineKey {
  /** This segment's own posted amount for this line. */
  ownAmount: number;
  /** This segment's share of GEN's amount for this same line (0 if GEN has no such line, or no % configured). */
  allocatedAmount: number;
  total: number;
}

export interface SegmentPnlTotals {
  income: number;
  cogs: number;
  grossProfit: number;
  expense: number;
  otherIncome: number;
  otherExpense: number;
  netProfit: number;
}

export interface SegmentPnlResult {
  segment: string;
  ownTotals: SegmentPnlTotals;
  allocatedTotals: SegmentPnlTotals;
  lines: SegmentPnlLine[]; // merged detail, sorted by section then group then description
}

function lineKey(section: PnlSection, group: string | null, description: string): string {
  return `${section}|${group ?? ''}|${description}`;
}

function emptyTotals(): SegmentPnlTotals {
  return { income: 0, cogs: 0, grossProfit: 0, expense: 0, otherIncome: 0, otherExpense: 0, netProfit: 0 };
}

function addToTotals(totals: SegmentPnlTotals, section: PnlSection, amount: number) {
  if (section === 'income') totals.income += amount;
  else if (section === 'cogs') totals.cogs += amount;
  else if (section === 'expense') totals.expense += amount;
  else if (section === 'otherIncome') totals.otherIncome += amount;
  else totals.otherExpense += amount;
}

function finalizeTotals(totals: SegmentPnlTotals) {
  totals.grossProfit = totals.income + totals.cogs;
  totals.netProfit = totals.income + totals.cogs + totals.expense + totals.otherIncome + totals.otherExpense;
}

/**
 * Full, detailed, fully-allocated P&L for every non-GEN segment present in `records`, across
 * `months`. Every one of GEN's line items is split by that month's configured % and merged - by
 * section/group/description - directly into the matching line on the target segment's own P&L
 * (creating the line if the segment didn't already have one), so the result is a complete
 * detailed statement per segment, not just a single "overhead" summary figure: e.g. GEN's
 * "Electricity" line shows up inside HT's expense detail too, at HT's allocated share.
 */
export function computeSegmentPnl(
  records: PnlLineRecord[],
  months: string[],
  segments: string[],
  allocationRules: SegmentAllocationRule[],
  mode: AllocationMode = 'percentage',
): SegmentPnlResult[] {
  const monthSet = new Set(months);
  const targetSegments = segments.filter((s) => s !== GENERAL_SEGMENT);
  const results: SegmentPnlResult[] = [];

  for (const segment of targetSegments) {
    const percentByMonth = new Map(
      months.map((m) => [m, resolveMonthlyAllocationPercent(records, mode, allocationRules, segment, m, targetSegments)]),
    );
    const lineMap = new Map<string, SegmentPnlLine>();

    for (const r of records) {
      if (!monthSet.has(r.month)) continue;
      if (r.segment !== segment && r.segment !== GENERAL_SEGMENT) continue;

      const key = lineKey(r.section, r.group, r.description);
      let line = lineMap.get(key);
      if (!line) {
        line = { section: r.section, group: r.group, description: r.description, ownAmount: 0, allocatedAmount: 0, total: 0 };
        lineMap.set(key, line);
      }
      if (r.segment === segment) {
        line.ownAmount += r.amount;
      } else {
        line.allocatedAmount += r.amount * ((percentByMonth.get(r.month) ?? 0) / 100);
      }
    }

    const lines = [...lineMap.values()]
      .map((l) => ({ ...l, total: l.ownAmount + l.allocatedAmount }))
      .filter((l) => l.ownAmount !== 0 || l.allocatedAmount !== 0)
      .sort(
        (a, b) =>
          SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
          (a.group ?? '').localeCompare(b.group ?? '') ||
          a.description.localeCompare(b.description),
      );

    const ownTotals = emptyTotals();
    const allocatedTotals = emptyTotals();
    for (const l of lines) {
      addToTotals(ownTotals, l.section, l.ownAmount);
      addToTotals(allocatedTotals, l.section, l.total);
    }
    finalizeTotals(ownTotals);
    finalizeTotals(allocatedTotals);

    results.push({ segment, ownTotals, allocatedTotals, lines });
  }

  return results;
}

/** Every distinct (section, group, description) line key across a set of segment results, ordered for a combined detail table. */
export function unionLineKeys(results: SegmentPnlResult[]): PnlLineKey[] {
  const map = new Map<string, PnlLineKey>();
  for (const r of results) {
    for (const l of r.lines) {
      const key = lineKey(l.section, l.group, l.description);
      if (!map.has(key)) map.set(key, { section: l.section, group: l.group, description: l.description });
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
      (a.group ?? '').localeCompare(b.group ?? '') ||
      a.description.localeCompare(b.description),
  );
}

export interface SegmentGroupTotal {
  group: string;
  own: number;
  total: number;
}

/** This segment's own+allocated subtotal for each group within a section (e.g. every EXPENSE group: Administration Expenses, Human Resource Expenses, Depreciation, ...) - "Other" for lines with no group. */
export function computeGroupTotals(result: SegmentPnlResult, section: PnlSection): Map<string, SegmentGroupTotal> {
  const map = new Map<string, SegmentGroupTotal>();
  for (const l of result.lines) {
    if (l.section !== section) continue;
    const key = l.group ?? 'Other';
    let g = map.get(key);
    if (!g) {
      g = { group: key, own: 0, total: 0 };
      map.set(key, g);
    }
    g.own += l.ownAmount;
    g.total += l.total;
  }
  return map;
}

/** Every group name used within a section across all segments, ordered by combined magnitude (largest first) so the biggest cost centers lead. */
export function unionGroups(results: SegmentPnlResult[], section: PnlSection): string[] {
  const magnitude = new Map<string, number>();
  for (const r of results) {
    for (const [group, g] of computeGroupTotals(r, section)) {
      magnitude.set(group, (magnitude.get(group) ?? 0) + Math.abs(g.total));
    }
  }
  return [...magnitude.entries()].sort((a, b) => b[1] - a[1]).map(([group]) => group);
}

/** Months (from what's actually been uploaded) making up the year-to-date range ending at `throughMonth`, inclusive - only months that were actually imported, so a gap doesn't get silently treated as zero. */
export function resolveYtdMonths(availableMonths: string[], throughMonth: string): string[] {
  const year = throughMonth.slice(0, 4);
  return availableMonths.filter((m) => m.startsWith(year) && m <= throughMonth).sort();
}

export function summarizeBatchMonths(batches: PnlImportBatch[]): string[] {
  return [...new Set(batches.map((b) => b.month))].sort();
}
