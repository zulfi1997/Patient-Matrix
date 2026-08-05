import type { SaleRecord } from '../types';
import { isInRange, type DateRange } from './metrics';
import { resolveProvider, type ProviderAssignmentOverride, type ProviderGroup } from './conversionMetrics';

/**
 * The Zenoti sales export has no "refund" item type. A refund is the original line reversed -
 * same Item Type, negative Qty and negative Sales (Exc. Tax) - so sales and refunds are separated
 * here by the sign of the line rather than by a column, which is also how `packageSales` in
 * kpiRegistry already reads them.
 */
export const REVENUE_TYPE_KEYS = [
  'service',
  'serviceRefund',
  'product',
  'productRefund',
  'package',
  'packageRefund',
  'other',
  'otherRefund',
] as const;

export type RevenueTypeKey = (typeof REVENUE_TYPE_KEYS)[number];

export const REVENUE_TYPE_LABELS: Record<RevenueTypeKey, string> = {
  service: 'Service',
  serviceRefund: 'Service Refund',
  product: 'Product',
  productRefund: 'Product Refund',
  package: 'Package',
  packageRefund: 'Package Refund',
  other: 'Other',
  otherRefund: 'Other Refund',
};

export interface ProviderRevenueByType {
  provider: string;
  /** Signed revenue per bucket. Refund buckets are negative, as they appear in the source. */
  amounts: Record<RevenueTypeKey, number>;
  /** Line count per bucket, so a large figure can be told apart from a frequent one. */
  lines: Record<RevenueTypeKey, number>;
  /** Sum of every bucket above - equals this provider's Revenue KPI for the period. */
  netRevenue: number;
  /**
   * Value of previously-sold package sessions this provider consumed. Recognized as revenue when
   * the package was sold, so it is deliberately outside netRevenue and reported beside it.
   */
  redeemed: number;
  /** netRevenue + redeemed: everything delivered, however it was paid for. */
  deliveredValue: number;
}

function zeroed(): Record<RevenueTypeKey, number> {
  return Object.fromEntries(REVENUE_TYPE_KEYS.map((k) => [k, 0])) as Record<RevenueTypeKey, number>;
}

function bucketFor(record: SaleRecord): RevenueTypeKey {
  const base =
    record.itemType === 'Service' ? 'service'
      : record.itemType === 'Product' ? 'product'
        : record.itemType === 'Package' ? 'package'
          : 'other';
  // A zero-value reversal still carries a negative Qty, and belongs on the refund side even
  // though it moves no money - otherwise it inflates the sale-side line count.
  const isRefund = record.amount < 0 || (record.amount === 0 && record.qty < 0);
  return (isRefund ? `${base}Refund` : base) as RevenueTypeKey;
}

/**
 * Revenue split by item type and by direction (sale vs refund), per provider.
 *
 * Item types that are a means of payment rather than a sale - gift and prepaid cards - are already
 * dropped upstream by `toAnalysisRecords`, so anything reaching "Other" here is a real item type
 * this app has not named yet, and is surfaced rather than silently folded into one of the three.
 */
export function computeProviderRevenueByType(
  records: SaleRecord[],
  range: DateRange,
  providerGroups: ProviderGroup[],
  overrides: ProviderAssignmentOverride[],
): ProviderRevenueByType[] {
  const byProvider = new Map<string, ProviderRevenueByType>();

  for (const r of records) {
    if (!isInRange(r.date, range)) continue;
    const provider = resolveProvider(r.staff, r.date, providerGroups, overrides) || 'Unassigned';

    let row = byProvider.get(provider);
    if (!row) {
      row = { provider, amounts: zeroed(), lines: zeroed(), netRevenue: 0, redeemed: 0, deliveredValue: 0 };
      byProvider.set(provider, row);
    }

    const bucket = bucketFor(r);
    row.amounts[bucket] += r.amount;
    row.lines[bucket] += 1;
    row.netRevenue += r.amount;
    row.redeemed += r.redeemedAmount;
    row.deliveredValue += r.amount + r.redeemedAmount;
  }

  return [...byProvider.values()].sort((a, b) => b.netRevenue - a.netRevenue);
}

/** The same shape summed across providers, for a totals row that reconciles to the Revenue KPI. */
export function totalRevenueByType(rows: ProviderRevenueByType[]): ProviderRevenueByType {
  const total: ProviderRevenueByType = {
    provider: 'All Providers',
    amounts: zeroed(),
    lines: zeroed(),
    netRevenue: 0,
    redeemed: 0,
    deliveredValue: 0,
  };
  for (const row of rows) {
    for (const k of REVENUE_TYPE_KEYS) {
      total.amounts[k] += row.amounts[k];
      total.lines[k] += row.lines[k];
    }
    total.netRevenue += row.netRevenue;
    total.redeemed += row.redeemed;
    total.deliveredValue += row.deliveredValue;
  }
  return total;
}

/**
 * Buckets worth showing: the six the clinic asked for, always, plus "Other" only when something
 * actually landed there. An empty Other column on every row is noise; a populated one is a
 * question that needs answering.
 */
export function visibleRevenueTypeKeys(total: ProviderRevenueByType): RevenueTypeKey[] {
  return REVENUE_TYPE_KEYS.filter(
    (k) => (k !== 'other' && k !== 'otherRefund') || total.lines[k] > 0,
  );
}
