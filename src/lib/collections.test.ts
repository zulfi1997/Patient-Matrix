import { describe, expect, it } from 'vitest';
import { buildInvoiceProviderShares, cashCollectedFor, computeProviderCollections } from './collections';
import { classifyPaymentMethod, isCashCollection } from './collectionsParser';
import { makeSale } from '../test/fixtures';
import type { CollectionRecord } from '../types';
import type { DateRange } from './metrics';

const RANGE: DateRange = { start: '2026-07-01', end: '2026-07-31' };

const payment = (over: Partial<CollectionRecord> = {}): CollectionRecord => ({
  id: 'c1', importBatchId: 'b1', date: '2026-07-10', invoiceNo: 'TBC1',
  patientId: 'MUS1', patientName: 'Test Patient', centerName: 'Main',
  paymentType: 'Card', method: 'card', amount: 100, taxCollected: 0,
  invoiceStatus: 'Closed', collectedBy: 'Cashier', comments: null, ...over,
});

const shares = (records: Parameters<typeof buildInvoiceProviderShares>[0]) =>
  buildInvoiceProviderShares(records, [], []);

describe('classifyPaymentMethod', () => {
  it('reads the redemption types off their prefix, since each carries its own identity', () => {
    // Real values from the export: the package or card is appended, so equality would never match.
    expect(classifyPaymentMethod('Package - derma-Custom Package-Buthina Ali-20260730183827')).toBe('package');
    expect(classifyPaymentMethod('Gift Card(2190)')).toBe('giftCard');
    expect(classifyPaymentMethod('Prepaid Card(PR202606103435168179)')).toBe('prepaidCard');
  });

  it('treats everything else as money arriving', () => {
    expect(classifyPaymentMethod('Card')).toBe('card');
    expect(classifyPaymentMethod('Cash')).toBe('cash');
    expect(classifyPaymentMethod('Custom - Bank Transfer - Bank Muscat')).toBe('bankTransfer');
    expect(classifyPaymentMethod('Custom - Void Payment')).toBe('other');
  });

  it('counts only the non-redemption methods as cash collected', () => {
    expect(['card', 'cash', 'bankTransfer', 'other'].every((m) => isCashCollection(m as never))).toBe(true);
    expect(['package', 'giftCard', 'prepaidCard'].some((m) => isCashCollection(m as never))).toBe(false);
  });
});

describe('buildInvoiceProviderShares', () => {
  it('gives a single-provider invoice the whole payment', () => {
    const result = shares([makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 300 })]);
    expect(result.get('TBC1')).toEqual([{ provider: 'Dr A', share: 1 }]);
  });

  it('splits a shared invoice by each provider\'s share of its revenue', () => {
    const result = shares([
      makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 300 }),
      makeSale({ invoiceNo: 'TBC1', staff: 'Dr B', amount: 100 }),
    ]);
    expect(result.get('TBC1')).toEqual([
      { provider: 'Dr A', share: 0.75 },
      { provider: 'Dr B', share: 0.25 },
    ]);
  });

  it('falls back to delivered value on an invoice that took no new cash', () => {
    // A pure redemption invoice: weighting by revenue would be 0/0 and drop the payment entirely.
    const result = shares([
      makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 0, redeemedAmount: 90 }),
      makeSale({ invoiceNo: 'TBC1', staff: 'Dr B', amount: 0, redeemedAmount: 30 }),
    ]);
    expect(result.get('TBC1')).toEqual([
      { provider: 'Dr A', share: 0.75 },
      { provider: 'Dr B', share: 0.25 },
    ]);
  });

  it('falls back to an equal split when nothing on the invoice has value', () => {
    const result = shares([
      makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 0 }),
      makeSale({ invoiceNo: 'TBC1', staff: 'Dr B', amount: 0 }),
    ]);
    expect(result.get('TBC1')).toEqual([
      { provider: 'Dr A', share: 0.5 },
      { provider: 'Dr B', share: 0.5 },
    ]);
  });

  it('resolves through provider groups', () => {
    const result = buildInvoiceProviderShares(
      [makeSale({ invoiceNo: 'TBC1', staff: 'Rini Antony', amount: 100 })],
      [{ id: 'g1', canonicalName: 'Dr Obada', aliases: ['Rini Antony'] }],
      [],
    );
    expect(result.get('TBC1')).toEqual([{ provider: 'Dr Obada', share: 1 }]);
  });
});

describe('computeProviderCollections', () => {
  const sales = () => [
    makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 300 }),
    makeSale({ invoiceNo: 'TBC2', staff: 'Dr B', amount: 200 }),
  ];

  it('keeps package, gift-card and prepaid settlements out of cash collected', () => {
    // The clinic's rule: that money arrived when the package or card was bought. Counting it again
    // as it is consumed would book the same cash twice.
    const result = computeProviderCollections([
      payment({ id: 'p1', invoiceNo: 'TBC1', method: 'card', amount: 100 }),
      payment({ id: 'p2', invoiceNo: 'TBC1', method: 'package', amount: 500 }),
      payment({ id: 'p3', invoiceNo: 'TBC1', method: 'giftCard', amount: 50 }),
      payment({ id: 'p4', invoiceNo: 'TBC1', method: 'prepaidCard', amount: 25 }),
    ], shares(sales()), RANGE);
    expect(cashCollectedFor(result, 'Dr A')).toBe(100);
    expect(result.providers[0].redemptionSettled).toBe(575);
    expect(result.totalCash).toBe(100);
  });

  it('splits a shared invoice\'s payment across its providers', () => {
    const invoiceShares = shares([
      makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 300 }),
      makeSale({ invoiceNo: 'TBC1', staff: 'Dr B', amount: 100 }),
    ]);
    const result = computeProviderCollections([payment({ amount: 400 })], invoiceShares, RANGE);
    expect(cashCollectedFor(result, 'Dr A')).toBe(300);
    expect(cashCollectedFor(result, 'Dr B')).toBe(100);
  });

  it('reports a payment whose invoice is not in the sales data instead of dropping it', () => {
    const result = computeProviderCollections([payment({ invoiceNo: 'UNKNOWN', amount: 80 })], shares(sales()), RANGE);
    expect(result.providers).toEqual([]);
    expect(result.unattributedCash).toBe(80);
    expect(result.unattributedPayments).toBe(1);
    // Still in the total, so the file reconciles even where attribution could not.
    expect(result.totalCash).toBe(80);
  });

  it('filters by collection date, not sale date', () => {
    const result = computeProviderCollections([
      payment({ id: 'p1', date: '2026-07-10', amount: 100 }),
      payment({ id: 'p2', date: '2026-08-01', amount: 999 }),
    ], shares(sales()), RANGE);
    expect(result.totalCash).toBe(100);
  });

  it('counts distinct invoices separately from payments, so instalments are visible', () => {
    const result = computeProviderCollections([
      payment({ id: 'p1', invoiceNo: 'TBC1', amount: 60 }),
      payment({ id: 'p2', invoiceNo: 'TBC1', amount: 40 }),
    ], shares(sales()), RANGE);
    expect(result.providers[0]).toMatchObject({ invoices: 1, payments: 2, cashCollected: 100 });
  });

  it('keeps a refund negative rather than dropping it', () => {
    const result = computeProviderCollections([
      payment({ id: 'p1', amount: 500 }),
      payment({ id: 'p2', method: 'bankTransfer', paymentType: 'Custom - Refund - Internal', amount: -120 }),
    ], shares(sales()), RANGE);
    expect(cashCollectedFor(result, 'Dr A')).toBe(380);
  });
});

describe('the summary reconciles', () => {
  it('total cash equals attributed plus unattributed, so the footer can tie to the source report', () => {
    // The regression: the All Providers footer showed attributed cash only, so it read low against
    // Zenoti's own Total Collections by exactly the amount that could not be matched.
    const invoiceShares = buildInvoiceProviderShares([makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 300 })], [], []);
    const result = computeProviderCollections([
      payment({ id: 'p1', invoiceNo: 'TBC1', amount: 300 }),
      payment({ id: 'p2', invoiceNo: 'GONE', amount: 120 }),
    ], invoiceShares, RANGE);

    const attributed = result.providers.reduce((s, p) => s + p.cashCollected, 0);
    expect(attributed).toBe(300);
    expect(result.unattributedCash).toBe(120);
    expect(result.totalCash).toBe(attributed + result.unattributedCash);
  });

  it('holds for redemption too', () => {
    const invoiceShares = buildInvoiceProviderShares([makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 300 })], [], []);
    const result = computeProviderCollections([
      payment({ id: 'p1', invoiceNo: 'TBC1', method: 'package', amount: 200 }),
      payment({ id: 'p2', invoiceNo: 'GONE', method: 'giftCard', amount: 50 }),
    ], invoiceShares, RANGE);
    const attributed = result.providers.reduce((s, p) => s + p.redemptionSettled, 0);
    expect(result.totalRedemption).toBe(attributed + result.unattributedRedemption);
    expect(result.totalRedemption).toBe(250);
  });
});

describe('attribution sees the whole sales history, not the analysis set', () => {
  it('attributes cash taken for a gift or prepaid card, whose invoice sells nothing else', () => {
    // The regression: shares were built from analysis records, which drop gift/prepaid-card lines -
    // right for revenue, since a card is not a sale until redeemed. But an invoice selling only a
    // card then vanished, and the cash somebody took for it could be attributed to nobody. On the
    // clinic's own file this accounted for 96% of everything reported as unattributed.
    const raw = [
      makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', itemType: 'Pre-paid card', serviceName: 'PrepaidCard#:11036', amount: 210 }),
    ];
    const result = computeProviderCollections([payment({ invoiceNo: 'TBC1', amount: 210 })], shares(raw), RANGE);
    expect(cashCollectedFor(result, 'Dr A')).toBe(210);
    expect(result.unattributedCash).toBe(0);
  });

  it('still does not count the card again when it is later redeemed', () => {
    // Selling the card is cash in; spending it later is not. Both facts have to hold at once.
    const raw = [makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', itemType: 'Gift card', amount: 100 })];
    const result = computeProviderCollections([
      payment({ id: 'p1', invoiceNo: 'TBC1', method: 'card', amount: 100 }),
      payment({ id: 'p2', invoiceNo: 'TBC1', method: 'giftCard', amount: 100 }),
    ], shares(raw), RANGE);
    expect(cashCollectedFor(result, 'Dr A')).toBe(100);
    expect(result.providers[0].redemptionSettled).toBe(100);
  });
});

describe('unattributed payments are traceable', () => {
  it('keeps the payments themselves, not just their total', () => {
    // A total nobody can trace is a total nobody can act on: the useful question is which invoice,
    // on which date, and that can only be answered from the payments.
    const invoiceShares = buildInvoiceProviderShares([makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 300 })], [], []);
    const result = computeProviderCollections([
      payment({ id: 'p1', invoiceNo: 'TBC1', amount: 300 }),
      payment({ id: 'p2', invoiceNo: 'GONE', amount: 120, date: '2026-07-21', patientName: 'Mais Qeissieh' }),
    ], invoiceShares, RANGE);

    expect(result.unattributed).toHaveLength(1);
    expect(result.unattributed[0]).toMatchObject({ invoiceNo: 'GONE', date: '2026-07-21', patientName: 'Mais Qeissieh' });
    expect(result.unattributed.reduce((s, r) => s + r.amount, 0)).toBe(result.unattributedCash + result.unattributedRedemption);
  });
});
