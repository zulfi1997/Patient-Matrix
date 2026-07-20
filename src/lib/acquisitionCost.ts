import type { PnlLineRecord } from '../types';
import type { DateRange } from './metrics';
import { toISODate } from './format';

const MARKETING_GROUP = 'Marketing and Promotion';
const AD_CAMPAIGN_DESCRIPTION = 'social media add campaigns';

/**
 * Every calendar month (ISO yyyy-mm-01) the given range touches, inclusive of partial months at
 * either end - Segment P&L data has no finer granularity than a full month, so this is the
 * natural unit to align marketing spend against, even when the dashboard's own period selector
 * is set to a partial month (e.g. "This month" while it's still in progress).
 */
export function wholeMonthsTouching(range: DateRange): string[] {
  const months: string[] = [];
  const start = new Date(`${range.start}T00:00:00`);
  const end = new Date(`${range.end}T00:00:00`);
  let d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d <= end) {
    months.push(toISODate(d));
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return months;
}

export interface AcquisitionCostInputs {
  /** ISO yyyy-mm-01 - the subset of touched months that actually have uploaded Segment P&L data. */
  monthsCovered: string[];
  /** Positive OMR. */
  adCampaignSpend: number;
  /** Positive OMR. */
  totalMarketingSpend: number;
  /** First day of the earliest covered month to the last day of the latest - null if no months are covered. Used to count New Patients on the same monthly basis as the spend figures, so the ratio isn't comparing a full-month cost against a partial-month patient count. */
  effectiveRange: DateRange | null;
}

/** Company-wide (all segments) Marketing and Promotion spend for whichever of `touchedMonths` have uploaded Segment P&L data. */
export function computeAcquisitionCostInputs(pnlLines: PnlLineRecord[], touchedMonths: string[]): AcquisitionCostInputs {
  const availableMonths = new Set(pnlLines.map((r) => r.month));
  const monthsCovered = touchedMonths.filter((m) => availableMonths.has(m)).sort();
  const monthSet = new Set(monthsCovered);

  let adCampaignSpend = 0;
  let totalMarketingSpend = 0;
  for (const r of pnlLines) {
    if (!monthSet.has(r.month) || r.group !== MARKETING_GROUP) continue;
    totalMarketingSpend += Math.abs(r.amount);
    if (r.description.trim().toLowerCase() === AD_CAMPAIGN_DESCRIPTION) {
      adCampaignSpend += Math.abs(r.amount);
    }
  }

  let effectiveRange: DateRange | null = null;
  if (monthsCovered.length > 0) {
    const last = new Date(`${monthsCovered[monthsCovered.length - 1]}T00:00:00`);
    const lastDayOfLastMonth = new Date(last.getFullYear(), last.getMonth() + 1, 0);
    effectiveRange = { start: monthsCovered[0], end: toISODate(lastDayOfLastMonth) };
  }

  return { monthsCovered, adCampaignSpend, totalMarketingSpend, effectiveRange };
}
