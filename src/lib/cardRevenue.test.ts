import { describe, expect, it } from 'vitest';
import { rowsToRecords } from './excelParser';
import { toAnalysisRecords } from './filters';
import { computeKpis, summarizePatients, type DateRange } from './metrics';
import { headerMapFor } from '../test/fixtures';

const RANGE: DateRange = { start: '2026-07-01', end: '2026-07-31' };
const base = { 'Guest Code': 'M1', 'Guest Name': 'A', Qty: 1, 'Invoice status': 'Closed', 'Sale Date': '7/5/2026' };

function parse(rows: Record<string, unknown>[]) {
  return rowsToRecords(rows, headerMapFor(rows), 'b1').records;
}

function kpisFor(rows: Record<string, unknown>[]) {
  const analysis = toAnalysisRecords(parse(rows));
  return computeKpis(analysis, RANGE, summarizePatients(analysis), 60, '2026-07-31');
}

/**
 * A gift or prepaid card is a means of payment, not a sale. Buying one is never revenue; the
 * invoice the card later settles is the sale, and it counts in full however it was paid. Counting
 * both would book the same money twice - once on the card, once on the service it buys.
 *
 * This is deliberately distinct from a package session being consumed, which really was already
 * recognized as revenue when the package itself was sold, and so must not be counted again.
 */
describe('gift and prepaid cards are payment, not revenue', () => {
  const giftCardPurchase = { ...base, 'Invoice No': 'GC1', 'Item Name': 'Gift Card 500', 'Item Type': 'Gift card', 'Sales (Exc. Tax)': 500 };
  const paidByGiftCard = {
    ...base, 'Invoice No': 'S1', 'Sale Date': '7/9/2026', 'Item Name': 'HydraFacial', 'Item Type': 'Service',
    'Item Code': 'HF', 'Sales (Exc. Tax)': 100, 'Payment Type': 'Gift Card(GC1)', Redeemed: 100,
  };
  const paidByPrepaidCard = {
    ...base, 'Invoice No': 'S2', 'Sale Date': '7/10/2026', 'Item Name': 'IV Drip', 'Item Type': 'Service',
    'Item Code': 'IV', 'Sales (Exc. Tax)': 80, 'Payment Type': 'Prepaid Card(OMR 500)', Redeemed: 80,
  };
  const packageSessionConsumed = {
    ...base, 'Invoice No': 'S3', 'Sale Date': '7/11/2026', 'Item Name': 'Laser', 'Item Type': 'Service',
    'Item Code': 'LS', 'Sales (Exc. Tax)': 60, 'Payment Type': 'Package - LHR 3 Sessions', Redeemed: 60,
  };

  it('does not count buying a card as revenue', () => {
    expect(kpisFor([giftCardPurchase]).periodRevenue).toBe(0);
  });

  it('drops the card purchase line from analysis entirely', () => {
    expect(toAnalysisRecords(parse([giftCardPurchase]))).toHaveLength(0);
  });

  it('counts an invoice settled by gift card in full', () => {
    expect(kpisFor([paidByGiftCard]).periodRevenue).toBe(100);
  });

  it('counts an invoice settled by prepaid card in full', () => {
    expect(kpisFor([paidByPrepaidCard]).periodRevenue).toBe(80);
  });

  it('books the money once across selling a card and spending it', () => {
    // The double-count this guards: 500 card + 100 service must be 100, not 600 and not 0.
    const kpis = kpisFor([giftCardPurchase, paidByGiftCard]);
    expect(kpis.periodRevenue).toBe(100);
    expect(kpis.periodRedeemedRevenue).toBe(0);
  });

  it('never reports card settlement as package redemption', () => {
    // redeemedAmount is reserved for package sessions; a card filling the Redeemed column must
    // not be mistaken for one, or the invoice would be stripped of its revenue.
    const [gift] = parse([paidByGiftCard]);
    const [prepaid] = parse([paidByPrepaidCard]);
    expect(gift).toMatchObject({ amount: 100, redeemedAmount: 0, packageName: null });
    expect(prepaid).toMatchObject({ amount: 80, redeemedAmount: 0, packageName: null });
  });

  it('still excludes a consumed package session, which was already recognized', () => {
    const kpis = kpisFor([packageSessionConsumed]);
    expect(kpis.periodRevenue).toBe(0);
    expect(kpis.periodRedeemedRevenue).toBe(60);
  });

  it('separates the two mechanisms across a full mixed period', () => {
    const kpis = kpisFor([giftCardPurchase, paidByGiftCard, paidByPrepaidCard, packageSessionConsumed]);
    expect(kpis.periodRevenue).toBe(180); // the two card-settled invoices, in full
    expect(kpis.periodRedeemedRevenue).toBe(60); // the package session, reported separately
  });
});
