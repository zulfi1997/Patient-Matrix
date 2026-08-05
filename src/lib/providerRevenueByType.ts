import type { SaleRecord } from '../types';
import { isInRange, type DateRange } from './metrics';
import { resolveProvider, type ProviderAssignmentOverride, type ProviderGroup, type RevenueAdjustment } from './conversionMetrics';
import { REVENUE_TYPE_KEYS, type RevenueTypeKey } from './revenueTypes';

/**
 * The Zenoti sales export has no "refund" item type. A refund is the original line reversed -
 * same Item Type, negative Qty and negative Sales (Exc. Tax) - so sales and refunds are separated
 * here by the sign of the line rather than by a column, which is also how `packageSales` in
 * kpiRegistry already reads them.
 */
export { REVENUE_TYPE_KEYS, REVENUE_TYPE_LABELS, type RevenueTypeKey } from './revenueTypes';

export interface ProviderRevenueByType {
  provider: string;
  /** Signed revenue per bucket. Refund buckets are negative, as they appear in the source. */
  amounts: Record<RevenueTypeKey, number>;
  /** Line count per bucket, so a large figure can be told apart from a frequent one. */
  lines: Record<RevenueTypeKey, number>;
  /**
   * Net effect of Master Control Revenue Adjustments that named no item type, so there was no
   * column to move. Adjustments that did name one are already inside `amounts` instead.
   */
  adjustment: number;
  /**
   * Sum of every bucket above plus `adjustment` - the same adjusted basis the Provider Conversion
   * tab reports. Adjustments only move revenue between providers, so the All Providers total is
   * unaffected by them and still equals the dashboard's Revenue figure.
   */
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
  revenueAdjustments: RevenueAdjustment[] = [],
): ProviderRevenueByType[] {
  const byProvider = new Map<string, ProviderRevenueByType>();
  const rowFor = (provider: string) => {
    let row = byProvider.get(provider);
    if (!row) {
      row = { provider, amounts: zeroed(), lines: zeroed(), adjustment: 0, netRevenue: 0, redeemed: 0, deliveredValue: 0 };
      byProvider.set(provider, row);
    }
    return row;
  };

  for (const r of records) {
    if (!isInRange(r.date, range)) continue;
    const row = rowFor(resolveProvider(r.staff, r.date, providerGroups, overrides));

    const bucket = bucketFor(r);
    row.amounts[bucket] += r.amount;
    row.lines[bucket] += 1;
    row.netRevenue += r.amount;
    row.redeemed += r.redeemedAmount;
    row.deliveredValue += r.amount + r.redeemedAmount;
  }

  // The same manual corrections the Provider Conversion tab applies, so the two tabs agree on what
  // a provider earned. An adjustment that names an item type moves that column; one that does not
  // lands in its own Adjustment column rather than being attributed to a type nobody stated.
  // Either way it only moves revenue between two providers, so the clinic-wide total is unchanged.
  for (const adj of revenueAdjustments) {
    if (!isInRange(adj.date, range) || adj.amount === 0) continue;
    const from = rowFor(resolveProvider(adj.fromProvider, adj.date, providerGroups, overrides));
    const to = rowFor(resolveProvider(adj.toProvider, adj.date, providerGroups, overrides));
    for (const [row, delta] of [[from, -adj.amount], [to, adj.amount]] as const) {
      if (adj.itemType) row.amounts[adj.itemType] += delta;
      else row.adjustment += delta;
      row.netRevenue += delta;
      row.deliveredValue += delta;
    }
  }

  return [...byProvider.values()].sort((a, b) => b.netRevenue - a.netRevenue);
}

/** The same shape summed across providers, for a totals row that reconciles to the Revenue KPI. */
export function totalRevenueByType(rows: ProviderRevenueByType[]): ProviderRevenueByType {
  const total: ProviderRevenueByType = {
    provider: 'All Providers',
    amounts: zeroed(),
    lines: zeroed(),
    adjustment: 0,
    netRevenue: 0,
    redeemed: 0,
    deliveredValue: 0,
  };
  for (const row of rows) {
    for (const k of REVENUE_TYPE_KEYS) {
      total.amounts[k] += row.amounts[k];
      total.lines[k] += row.lines[k];
    }
    total.adjustment += row.adjustment;
    total.netRevenue += row.netRevenue;
    total.redeemed += row.redeemed;
    total.deliveredValue += row.deliveredValue;
  }
  return total;
}

/**
 * Net effect of Revenue Adjustments on one provider over a date range - positive where revenue was
 * moved to them, negative where it was moved away. Both ends resolve through Provider Groups, so
 * an adjustment naming an assisting nurse lands on the doctor she assists.
 */
export function netAdjustmentForProvider(
  provider: string,
  range: DateRange,
  adjustments: RevenueAdjustment[],
  groups: ProviderGroup[],
  overrides: ProviderAssignmentOverride[],
): number {
  let net = 0;
  for (const adj of adjustments) {
    if (!isInRange(adj.date, range)) continue;
    if (resolveProvider(adj.toProvider, adj.date, groups, overrides) === provider) net += adj.amount;
    if (resolveProvider(adj.fromProvider, adj.date, groups, overrides) === provider) net -= adj.amount;
  }
  return net;
}

/** True when any adjustment landed without an item type, so the extra column has something in it. */
export function hasUntypedAdjustment(rows: ProviderRevenueByType[]): boolean {
  return rows.some((r) => r.adjustment !== 0);
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
