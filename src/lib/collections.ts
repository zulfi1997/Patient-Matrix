import type { CollectionAttributionOverride, CollectionMethod, CollectionRecord, SaleRecord } from '../types';
import { resolveProvider, type ProviderAssignmentOverride, type ProviderGroup } from './conversionMetrics';
import { isCashCollection } from './collectionsParser';
import { isInRange, type DateRange } from './metrics';

/** What resolveProvider returns for a sale line with no staff recorded. */
export const UNASSIGNED = 'Unassigned';

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
 * Most invoices are one provider and resolve to a single 100% share - there is nothing to split,
 * and none happens. Where an invoice genuinely carries several providers' lines, the payment is
 * split by each one's share of that invoice's value rather than handed whole to whichever happened
 * to be first. Weighting falls back to delivered value for an invoice that took no new cash (a
 * pure redemption), and only then to an equal split - a collection has to land somewhere, and
 * silently dropping it would make the column quietly understate every provider.
 *
 * A line with no staff on it resolves to "Unassigned", which is a provider like any other here: it
 * will take its share, and seeing it beside a real name on an invoice means that line has no seller
 * recorded in the sales data.
 */
export function buildInvoiceProviderShares(
  salesRecords: SaleRecord[],
  providerGroups: ProviderGroup[],
  overrides: ProviderAssignmentOverride[],
  attributionOverrides: CollectionAttributionOverride[] = [],
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
    const all = [...providers.entries()];
    // A line with no staff recorded is an absence of information, not a claim on the money. Where
    // the invoice names anyone at all, the payment belongs to the people it names and the blank
    // lines are dropped rather than diluting them. Only when nothing on the invoice has a seller
    // does it stay with Unassigned, where it is visible instead of silently handed to someone.
    const named = all.filter(([provider]) => provider !== UNASSIGNED);
    const entries = named.length > 0 ? named : all;
    // Weighted by magnitude, not by signed value. A refund invoice carries only negative amounts,
    // and clamping those to zero collapsed every weight - so the split fell through to counting
    // lines and divided the money equally between people who had sold wildly different shares of
    // it. Attribution is a question of whose money this is, which the size of a line answers just
    // as well when it is being handed back as when it was taken.
    for (const weightOf of [
      (v: { amount: number }) => Math.abs(v.amount),
      (v: { delivered: number }) => Math.abs(v.delivered),
      (v: { lines: number }) => v.lines,
    ]) {
      const total = entries.reduce((s, [, v]) => s + weightOf(v), 0);
      if (total > 0) {
        result.set(invoiceNo, entries.map(([provider, v]) => ({ provider, share: weightOf(v) / total })));
        break;
      }
    }
  }
  // Applied last, so a stated attribution beats anything derived - including an invoice the sales
  // data never mentions, which is the case the manual mapping mostly exists for.
  for (const o of attributionOverrides) {
    const invoiceNo = o.invoiceNo.trim();
    const provider = o.provider.trim();
    if (invoiceNo && provider) result.set(invoiceNo, [{ provider, share: 1 }]);
  }

  return result;
}

/**
 * Invoices that sell nothing but a gift or prepaid card.
 *
 * Needed because the Collections export cannot say so itself: refunding a card comes back as an
 * ordinary bank transfer or card payment with a negative amount, indistinguishable from a service
 * being refunded. Only the sales lines behind the invoice reveal that what was handed back was a
 * card. Mixed invoices are deliberately excluded - if a card was sold alongside services, the
 * payment is not purely a card movement and guessing which part is would be worse than not saying.
 */
export function buildCardOnlyInvoices(salesRecords: SaleRecord[]): Set<string> {
  const allCard = new Map<string, boolean>();
  for (const r of salesRecords) {
    if (!r.invoiceNo) continue;
    const isCard = r.itemType === 'Pre-paid card' || r.itemType === 'Gift card';
    allCard.set(r.invoiceNo, (allCard.get(r.invoiceNo) ?? true) && isCard);
  }
  return new Set([...allCard.entries()].filter(([, v]) => v).map(([k]) => k));
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
  /** Money in: every positive cash payment, before anything is handed back. */
  collected: number;
  /** Money out: every negative cash payment, kept negative so the three columns add up. */
  refunded: number;
  /** collected + refunded. */
  netCollected: number;
  /**
   * The part of `refunded` that is a gift or prepaid card being handed back rather than a service.
   * A subset, not a fourth bucket - it sits inside refunded and is broken out because the card was
   * paid for in an earlier period, so it says nothing about this period's trading.
   */
  cardRefunds: number;
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
  unattributedCollected: number;
  unattributedRefunded: number;
  unattributedRedemption: number;
  unattributedPayments: number;
  totalCollected: number;
  totalRefunded: number;
  totalNetCollected: number;
  totalCardRefunds: number;
  totalRedemption: number;
}

function emptyStat(provider: string): ProviderCollectionStat {
  return {
    provider,
    collected: 0,
    refunded: 0,
    netCollected: 0,
    cardRefunds: 0,
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
  cardOnlyInvoices: Set<string> = new Set(),
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
    unattributedCollected: 0,
    unattributedRefunded: 0,
    unattributedRedemption: 0,
    unattributedPayments: 0,
    totalCollected: 0,
    totalRefunded: 0,
    totalNetCollected: 0,
    totalCardRefunds: 0,
    totalRedemption: 0,
  };

  for (const c of collections) {
    if (!isInRange(c.date, range)) continue;
    const cash = isCashCollection(c.method);
    const refund = cash && c.amount < 0;
    // A card handed back is still a refund, but of money taken in some earlier period - broken out
    // as a subset so it can be read separately without leaving the arithmetic.
    const isCardRefund = refund && cardOnlyInvoices.has(c.invoiceNo);

    if (!cash) summary.totalRedemption += c.amount;
    else if (refund) {
      summary.totalRefunded += c.amount;
      if (isCardRefund) summary.totalCardRefunds += c.amount;
    } else summary.totalCollected += c.amount;

    const shares = invoiceShares.get(c.invoiceNo);
    if (!shares || shares.length === 0) {
      const reason = classifyUnmatched(c.invoiceNo, invoiceRanges);
      summary.unattributed.push({ payment: c, reason });
      summary.unattributedByReason[reason] += 1;
      if (!cash) summary.unattributedRedemption += c.amount;
      else if (refund) summary.unattributedRefunded += c.amount;
      else summary.unattributedCollected += c.amount;
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
      if (!cash) stat.redemptionSettled += amount;
      else if (refund) {
        stat.refunded += amount;
        if (isCardRefund) stat.cardRefunds += amount;
      } else stat.collected += amount;
      stat.byMethod[c.method] += amount;
      stat.payments += 1;
      invoicesSeen.get(provider)!.add(c.invoiceNo);
    }
  }

  for (const [provider, stat] of byProvider) {
    stat.invoices = invoicesSeen.get(provider)!.size;
    stat.netCollected = stat.collected + stat.refunded;
  }
  summary.totalNetCollected = summary.totalCollected + summary.totalRefunded;
  summary.providers = [...byProvider.values()].sort((a, b) => b.netCollected - a.netCollected);
  return summary;
}

/** Net cash for one provider - collections less refunds - for places showing a single figure. */
export function cashCollectedFor(summary: CollectionSummary, provider: string): number {
  return summary.providers.find((p) => p.provider === provider)?.netCollected ?? 0;
}


export interface InvoiceAttributionRow {
  invoiceNo: string;
  date: string;
  patientName: string;
  paymentType: string;
  method: CollectionMethod;
  amount: number;
  provider: string;
  share: number;
  attributed: number;
  /** How many providers the invoice resolved to - 1 means nothing was split. */
  providersOnInvoice: number;
}

/**
 * One row per payment per provider it was attributed to, with the share applied.
 *
 * Exists to answer "why is this provider's figure not the whole payment" without anyone having to
 * reason about it: either the invoice resolved to one provider and the share is 100%, or it did
 * not and every provider taking a piece is listed beside them. "Unassigned" appearing here means a
 * line on that invoice has no seller recorded in the sales data.
 */
export function invoiceAttributionDetail(
  collections: CollectionRecord[],
  invoiceShares: Map<string, InvoiceProviderShare[]>,
  range: DateRange,
): InvoiceAttributionRow[] {
  const rows: InvoiceAttributionRow[] = [];
  for (const c of collections) {
    if (!isInRange(c.date, range)) continue;
    const shares = invoiceShares.get(c.invoiceNo);
    if (!shares || shares.length === 0) continue;
    for (const { provider, share } of shares) {
      rows.push({
        invoiceNo: c.invoiceNo,
        date: c.date,
        patientName: c.patientName,
        paymentType: c.paymentType,
        method: c.method,
        amount: c.amount,
        provider,
        share,
        attributed: c.amount * share,
        providersOnInvoice: shares.length,
      });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNo.localeCompare(b.invoiceNo) || a.provider.localeCompare(b.provider));
}
