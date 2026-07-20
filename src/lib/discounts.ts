import type { SaleRecord } from '../types';
import { isInRange, type DateRange } from './metrics';

/**
 * Zenoti records every discount on the "Discount Name"/"Discount" columns, including a
 * "Package Redemption - ..." label for the bookkeeping value of a package session being
 * consumed - that's not a real discount (it's the same redemption already tracked via
 * SaleRecord.redeemedAmount/packageName), so it's classified separately and excluded from
 * "real" discount totals to avoid double-counting/confusion.
 */
export type DiscountCategory = 'manual' | 'campaign' | 'priceAdjusted' | 'packageRedemption' | 'other';

export const DISCOUNT_CATEGORY_LABELS: Record<DiscountCategory, string> = {
  manual: 'Manual Discount',
  campaign: 'Campaign',
  priceAdjusted: 'Price Adjusted',
  packageRedemption: 'Package Redemption (not a real discount)',
  other: 'Other',
};

export function classifyDiscount(discountName: string | null): { category: DiscountCategory; campaignName: string | null } {
  const name = (discountName || '').trim();
  if (!name) return { category: 'other', campaignName: null };
  const campaignMatch = /Campaign\s*-\s*(.+)/i.exec(name);
  if (campaignMatch) return { category: 'campaign', campaignName: campaignMatch[1].trim() };
  if (/Manual discount/i.test(name)) return { category: 'manual', campaignName: null };
  if (/Price adjusted/i.test(name)) return { category: 'priceAdjusted', campaignName: null };
  if (/Package Redemption/i.test(name)) return { category: 'packageRedemption', campaignName: null };
  return { category: 'other', campaignName: null };
}

function hasDiscount(r: SaleRecord): boolean {
  return r.discountAmount > 0 || !!(r.discountName && r.discountName.trim());
}

export interface DiscountSummary {
  /** Manual + Campaign + Price Adjusted + Other - excludes Package Redemption. */
  totalDiscount: number;
  manualDiscount: number;
  campaignDiscount: number;
  priceAdjustedDiscount: number;
  /** Informational only - the value of package sessions redeemed, not a real discount. */
  packageRedemptionDiscount: number;
  /** Line items with a real (non-package-redemption) discount applied. */
  discountedLineCount: number;
  /** Pre-discount value (amount + discountAmount) summed across every line in range, discounted or not. */
  grossSales: number;
  /** totalDiscount / grossSales, null if grossSales is 0. */
  discountPct: number | null;
}

export function computeDiscountSummary(records: SaleRecord[], range: DateRange): DiscountSummary {
  let manualDiscount = 0;
  let campaignDiscount = 0;
  let priceAdjustedDiscount = 0;
  let packageRedemptionDiscount = 0;
  let discountedLineCount = 0;
  let grossSales = 0;

  for (const r of records) {
    if (!isInRange(r.date, range)) continue;
    grossSales += r.amount + r.discountAmount;
    if (!hasDiscount(r)) continue;

    const { category } = classifyDiscount(r.discountName);
    if (category === 'packageRedemption') {
      packageRedemptionDiscount += r.discountAmount;
      continue;
    }
    discountedLineCount++;
    if (category === 'manual') manualDiscount += r.discountAmount;
    else if (category === 'campaign') campaignDiscount += r.discountAmount;
    else if (category === 'priceAdjusted') priceAdjustedDiscount += r.discountAmount;
  }

  const totalDiscount = manualDiscount + campaignDiscount + priceAdjustedDiscount;
  return {
    totalDiscount,
    manualDiscount,
    campaignDiscount,
    priceAdjustedDiscount,
    packageRedemptionDiscount,
    discountedLineCount,
    grossSales,
    discountPct: grossSales > 0 ? (totalDiscount / grossSales) * 100 : null,
  };
}

export interface DiscountBreakdownStat {
  label: string;
  category: DiscountCategory;
  count: number;
  amount: number;
}

/** One row per category (Manual, Price Adjusted) or per named Campaign - excludes Package Redemption. */
export function computeDiscountBreakdown(records: SaleRecord[], range: DateRange): DiscountBreakdownStat[] {
  const map = new Map<string, DiscountBreakdownStat>();
  for (const r of records) {
    if (!isInRange(r.date, range) || !hasDiscount(r)) continue;
    const { category, campaignName } = classifyDiscount(r.discountName);
    if (category === 'packageRedemption') continue;

    const label = category === 'campaign' ? campaignName || 'Campaign (unnamed)' : DISCOUNT_CATEGORY_LABELS[category];
    const key = `${category}:${label}`;
    if (!map.has(key)) map.set(key, { label, category, count: 0, amount: 0 });
    const stat = map.get(key)!;
    stat.count++;
    stat.amount += r.discountAmount;
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}
