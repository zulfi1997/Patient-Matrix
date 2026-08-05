import type { CollectionMethod, CollectionRecord, SaleRecord } from '../types';
import { resolveProvider, type ProviderAssignmentOverride, type ProviderGroup } from './conversionMetrics';
import { isCashCollection } from './collectionsParser';
import { isInRange, type DateRange } from './metrics';

/** The provider(s) an invoice's money belongs to, and how much of it each earned. */
export interface InvoiceProviderShare {
  provider: string;
  /** Fraction of the invoice, summing to 1 across its providers. */
  share: number;
}

/**
 * Who sold what on each invoice, as fractional shares.
 *
 * The Collections export has no usable staff column - "Collected By" is the cashier who took the
 * payment, not whoever sold the service - so attribution runs through the invoice number against
 * the sales data, which is what the clinic asked for.
 *
 * Most invoices are one provider and resolve to a single 100% share. Where an invoice carries
 * several providers' lines, the payment is split by each one's share of that invoice's revenue
 * rather than handed whole to whichever happened to be first. Weighting falls back to delivered
 * value for an invoice that took no new cash (a pure redemption), and to an equal split when even
 * that is zero - a collection has to land somewhere, and silently dropping it would make the
 * column quietly understate every provider.
 */
export function buildInvoiceProviderShares(
  salesRecords: SaleRecord[],
  providerGroups: ProviderGroup[],
  overrides: ProviderAssignmentOverride[],
): Map<string, InvoiceProviderShare[]> {
  const byInvoice = new Map<string, Map<string, { amount: number; delivered: number; lines: number }>>();

  for (const r of salesRecords) {
    if (!r.invoiceNo) continue;
    let providers = byInvoice.get(r.invoiceNo);
    if (!providers) {
      providers = new Map();
      byInvoice.set(r.invoiceNo, providers);
    }
    const provider = resolveProvider(r.staff, r.date, providerGroups, overrides);
    const acc = providers.get(provider) ?? { amount: 0, delivered: 0, lines: 0 };
    acc.amount += r.amount;
    acc.delivered += r.amount + r.redeemedAmount;
    acc.lines += 1;
    providers.set(provider, acc);
  }

  const result = new Map<string, InvoiceProviderShare[]>();
  for (const [invoiceNo, providers] of byInvoice) {
    const entries = [...providers.entries()];
    for (const weightOf of [
      (v: { amount: number }) => Math.max(v.amount, 0),
      (v: { delivered: number }) => Math.max(v.delivered, 0),
      (v: { lines: number }) => v.lines,
    ]) {
      const total = entries.reduce((s, [, v]) => s + weightOf(v), 0);
      if (total > 0) {
        result.set(invoiceNo, entries.map(([provider, v]) => ({ provider, share: weightOf(v) / total })));
        break;
      }
    }
  }
  return result;
}

/** The date span of the imported sales data, so an unmatched payment can be told from a boundary. */
export interface SalesSpan {
  start: string;
  end: string;
}

export function salesDateSpan(salesRecords: SaleRecord[]): SalesSpan | null {
  if (salesRecords.length === 0) return null;
  let start = salesRecords[0].date;
  let end = start;
  for (const r of salesRecords) {
    if (r.date < start) start = r.date;
    if (r.date > end) end = r.date;
  }
  return { start, end };
}

/**
 * The span of invoice *numbers* present in the sales data, per prefix.
 *
 * This, not the collection date, is what can tell a missing invoice from an un-imported one. A
 * payment's date says almost nothing about its invoice's: instalments mean money arrives months
 * after the sale, so "collected after the sales data ends" does not imply the invoice is after it
 * too. The invoice number does imply it - Zenoti allocates them sequentially, so a number above
 * everything imported was raised later, and one sitting inside the range should have been there.
 */
export type InvoiceNumberRanges = Map<string, { min: number; max: number }>;

const INVOICE_PATTERN = /^([A-Za-z]*)(\d+)$/;

export function invoiceNumberRanges(salesRecords: SaleRecord[]): InvoiceNumberRanges {
  const ranges: InvoiceNumberRanges = new Map();
  for (const r of salesRecords) {
    const m = INVOICE_PATTERN.exec(r.invoiceNo.trim());
    if (!m) continue;
    const prefix = m[1].toUpperCase();
    const n = Number(m[2]);
    const range = ranges.get(prefix);
    if (!range) ranges.set(prefix, { min: n, max: n });
    else {
      if (n < range.min) range.min = n;
      if (n > range.max) range.max = n;
    }
  }
  return ranges;
}

/**
 * Why a payment could not be attributed.
 *
 * The distinction that matters is whether a wider sales import would fix it. An invoice numbered
 * beyond everything imported has simply not been imported yet; one numbered inside the imported
 * range is a genuine gap. Only the second deserves anyone's attention.
 */
export type UnmatchedReason =
  | 'beyondImportedRange'
  | 'belowImportedRange'
  | 'withinImportedRange'
  | 'unrecognizedInvoiceNo'
  | 'noSalesData';

export const UNMATCHED_REASON_LABELS: Record<UnmatchedReason, string> = {
  beyondImportedRange: 'Invoice raised after the imported sales data - import newer sales',
  belowImportedRange: 'Invoice raised before the imported sales data - import older sales',
  withinImportedRange: 'Invoice number falls inside the imported range - genuinely missing',
  unrecognizedInvoiceNo: 'Invoice number not comparable to the imported sales data',
  noSalesData: 'No sales data imported',
};

/** True only for the reason a wider import would not fix. */
export function needsInvestigation(reason: UnmatchedReason): boolean {
  return reason === 'withinImportedRange';
}

export function classifyUnmatched(invoiceNo: string, ranges: InvoiceNumberRanges): UnmatchedReason {
  if (ranges.size === 0) return 'noSalesData';
  const m = INVOICE_PATTERN.exec(invoiceNo.trim());
  if (!m) return 'unrecognizedInvoiceNo';
  const range = ranges.get(m[1].toUpperCase());
  if (!range) return 'unrecognizedInvoiceNo';
  const n = Number(m[2]);
  if (n > range.max) return 'beyondImportedRange';
  if (n < range.min) return 'belowImportedRange';
  return 'withinImportedRange';
}

export interface UnmatchedPayment {
  payment: CollectionRecord;
  reason: UnmatchedReason;
}

export interface ProviderCollectionStat {
  provider: string;
  /** New money received: card, cash, bank transfer. */
  cashCollected: number;
  /** Settled by consuming a package, gift card or prepaid card - already paid for earlier, so not new money. */
  redemptionSettled: number;
  byMethod: Record<CollectionMethod, number>;
  /** Distinct invoices contributing, so a large figure can be told from a frequent one. */
  invoices: number;
  payments: number;
}

export interface CollectionSummary {
  providers: ProviderCollectionStat[];
  /**
   * The payments themselves, each with why it could not be matched, so an unmatched figure can be
   * traced rather than only wondered about.
   */
  unattributed: UnmatchedPayment[];
  /** How many fall in each reason, so the note can distinguish a window boundary from a real gap. */
  unattributedByReason: Record<UnmatchedReason, number>;
  salesSpan: SalesSpan | null;
  /** Payments whose invoice is not in the sales data, so no provider could be resolved. */
  unattributedCash: number;
  unattributedRedemption: number;
  unattributedPayments: number;
  totalCash: number;
  totalRedemption: number;
}

function emptyStat(provider: string): ProviderCollectionStat {
  return {
    provider,
    cashCollected: 0,
    redemptionSettled: 0,
    byMethod: { card: 0, cash: 0, bankTransfer: 0, other: 0, package: 0, giftCard: 0, prepaidCard: 0 },
    invoices: 0,
    payments: 0,
  };
}

/**
 * Cash collected per provider over a date range, by collection date rather than sale date - the
 * point of this figure is when the money arrived, which is often not when the sale was recognized.
 *
 * An instalment is the ordinary case, not an edge case: money for a June invoice arriving in August
 * counts in August, credited to whoever sold that June invoice. Shares are therefore built from the
 * whole sales history, never the period, so the seller is found however long ago the sale was.
 *
 * Package, gift-card and prepaid-card settlements are reported separately and deliberately kept
 * out of the cash figure: that money was collected when the package or card was bought, and
 * counting it again as it is consumed would book the same cash twice.
 */
export function computeProviderCollections(
  collections: CollectionRecord[],
  invoiceShares: Map<string, InvoiceProviderShare[]>,
  range: DateRange,
  salesSpan: SalesSpan | null = null,
  invoiceRanges: InvoiceNumberRanges = new Map(),
): CollectionSummary {
  const byProvider = new Map<string, ProviderCollectionStat>();
  const invoicesSeen = new Map<string, Set<string>>();
  const summary: CollectionSummary = {
    providers: [],
    unattributed: [],
    unattributedByReason: {
      beyondImportedRange: 0, belowImportedRange: 0, withinImportedRange: 0,
      unrecognizedInvoiceNo: 0, noSalesData: 0,
    },
    salesSpan,
    unattributedCash: 0,
    unattributedRedemption: 0,
    unattributedPayments: 0,
    totalCash: 0,
    totalRedemption: 0,
  };

  for (const c of collections) {
    if (!isInRange(c.date, range)) continue;
    const cash = isCashCollection(c.method);
    if (cash) summary.totalCash += c.amount;
    else summary.totalRedemption += c.amount;

    const shares = invoiceShares.get(c.invoiceNo);
    if (!shares || shares.length === 0) {
      const reason = classifyUnmatched(c.invoiceNo, invoiceRanges);
      summary.unattributed.push({ payment: c, reason });
      summary.unattributedByReason[reason] += 1;
      if (cash) summary.unattributedCash += c.amount;
      else summary.unattributedRedemption += c.amount;
      summary.unattributedPayments += 1;
      continue;
    }

    for (const { provider, share } of shares) {
      let stat = byProvider.get(provider);
      if (!stat) {
        stat = emptyStat(provider);
        byProvider.set(provider, stat);
        invoicesSeen.set(provider, new Set());
      }
      const amount = c.amount * share;
      if (cash) stat.cashCollected += amount;
      else stat.redemptionSettled += amount;
      stat.byMethod[c.method] += amount;
      stat.payments += 1;
      invoicesSeen.get(provider)!.add(c.invoiceNo);
    }
  }

  for (const [provider, stat] of byProvider) stat.invoices = invoicesSeen.get(provider)!.size;
  summary.providers = [...byProvider.values()].sort((a, b) => b.cashCollected - a.cashCollected);
  return summary;
}

/** Cash collected for one provider, for the places that show a single figure beside their revenue. */
export function cashCollectedFor(summary: CollectionSummary, provider: string): number {
  return summary.providers.find((p) => p.provider === provider)?.cashCollected ?? 0;
}
