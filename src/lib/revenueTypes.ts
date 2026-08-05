/**
 * The vocabulary for splitting revenue by what was sold and whether it was a sale or a reversal.
 *
 * Kept in its own module with no imports of its own: both providerRevenueByType (which computes
 * the split) and conversionMetrics (where a Revenue Adjustment can name one of these buckets)
 * need it, and those two already depend on each other in one direction.
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

export function isRevenueTypeKey(value: string): value is RevenueTypeKey {
  return (REVENUE_TYPE_KEYS as readonly string[]).includes(value);
}
