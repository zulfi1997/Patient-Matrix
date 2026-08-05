import { describe, expect, it } from 'vitest';
import {
  buildInvoiceProviderShares,
  cashCollectedFor,
  computeProviderCollections,
  invoiceNumberRanges,
  needsInvestigation,
  salesDateSpan,
} from './collections';
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
    expect(result.unattributed[0].payment).toMatchObject({ invoiceNo: 'GONE', date: '2026-07-21', patientName: 'Mais Qeissieh' });
    expect(result.unattributed.reduce((s, u) => s + u.payment.amount, 0)).toBe(result.unattributedCash + result.unattributedRedemption);
  });
});

describe('why a payment could not be matched', () => {
  // Sales data holding TBC26900 and TBC26993, so the imported number range is 26900-26993.
  const sales = [
    makeSale({ invoiceNo: 'TBC26900', staff: 'Dr A', date: '2026-07-01', amount: 100 }),
    makeSale({ invoiceNo: 'TBC26993', staff: 'Dr A', date: '2026-07-20', amount: 300 }),
  ];
  const summaryFor = (invoiceNo: string, date = '2026-07-21', range: DateRange = RANGE) =>
    computeProviderCollections(
      [payment({ invoiceNo, date, amount: 256 })],
      shares(sales),
      range,
      salesDateSpan(sales),
      invoiceNumberRanges(sales),
    );

  it('judges by invoice number, not collection date, because instalments break the date inference', () => {
    // TBC26958 sits inside the imported range but is absent: a real gap, whatever date it was paid.
    // Judging by collection date instead called this "after the sales data" purely because the
    // payment landed on the 21st, which pointed at the wrong fix.
    expect(summaryFor('TBC26958').unattributed[0].reason).toBe('withinImportedRange');
    expect(summaryFor('TBC26958').unattributedByReason.withinImportedRange).toBe(1);
  });

  it('does not blame the date when an instalment settles an old invoice late', () => {
    // Paid long after the sales data ends, but the invoice number is inside the imported range, so
    // the diagnosis is "missing row", not "import newer sales".
    const late = summaryFor('TBC26950', '2026-11-30', { start: '2026-11-01', end: '2026-11-30' });
    expect(late.unattributed[0].reason).toBe('withinImportedRange');
  });

  it('recognizes an invoice numbered beyond everything imported', () => {
    const result = summaryFor('TBC27030');
    expect(result.unattributed[0].reason).toBe('beyondImportedRange');
    expect(needsInvestigation(result.unattributed[0].reason)).toBe(false);
  });

  it('recognizes an invoice numbered before everything imported', () => {
    expect(summaryFor('TBC12345').unattributed[0].reason).toBe('belowImportedRange');
  });

  it('will not guess when the invoice number is not comparable', () => {
    // A different centre's prefix, or a format this app has never seen: saying nothing beats
    // asserting a range comparison that means nothing.
    expect(summaryFor('XYZ55').unattributed[0].reason).toBe('unrecognizedInvoiceNo');
    expect(summaryFor('TBC-26/958').unattributed[0].reason).toBe('unrecognizedInvoiceNo');
  });

  it('flags only the in-range case as needing investigation', () => {
    expect(needsInvestigation('withinImportedRange')).toBe(true);
    for (const r of ['beyondImportedRange', 'belowImportedRange', 'unrecognizedInvoiceNo', 'noSalesData'] as const) {
      expect(needsInvestigation(r)).toBe(false);
    }
  });
});

describe('instalments', () => {
  it('credits a late payment to whoever sold the original invoice, in the month the money arrived', () => {
    // The clinic's rule: regardless of when it is collected, the original sold-by is matched from
    // the earlier sales data and the cash lands in the collection month.
    const sales = [makeSale({ invoiceNo: 'TBC100', staff: 'Dr A', date: '2026-02-10', amount: 900 })];
    const invoiceShares = shares(sales);

    const july = computeProviderCollections([payment({ invoiceNo: 'TBC100', date: '2026-07-15', amount: 300 })], invoiceShares, RANGE);
    expect(cashCollectedFor(july, 'Dr A')).toBe(300);
    expect(july.unattributed).toEqual([]);

    // The same invoice's next instalment falls in a different month and must not appear in July's.
    const august = computeProviderCollections(
      [payment({ invoiceNo: 'TBC100', date: '2026-08-15', amount: 300 })],
      invoiceShares,
      { start: '2026-08-01', end: '2026-08-31' },
    );
    expect(cashCollectedFor(august, 'Dr A')).toBe(300);
    expect(cashCollectedFor(july, 'Dr A')).toBe(300);
  });

  it('finds the seller however long ago the sale was', () => {
    const sales = [makeSale({ invoiceNo: 'TBC100', staff: 'Dr A', date: '2024-03-01', amount: 500 })];
    const result = computeProviderCollections([payment({ invoiceNo: 'TBC100', amount: 500 })], shares(sales), RANGE);
    expect(cashCollectedFor(result, 'Dr A')).toBe(500);
  });
});

describe('invoiceNumberRanges', () => {
  it('spans the lowest and highest number per prefix', () => {
    const ranges = invoiceNumberRanges([
      makeSale({ invoiceNo: 'TBC100' }), makeSale({ invoiceNo: 'TBC26993' }), makeSale({ invoiceNo: 'ABC7' }),
    ]);
    expect(ranges.get('TBC')).toEqual({ min: 100, max: 26993 });
    expect(ranges.get('ABC')).toEqual({ min: 7, max: 7 });
  });

  it('skips invoice numbers it cannot parse rather than mangling them', () => {
    expect(invoiceNumberRanges([makeSale({ invoiceNo: 'TBC-1/2' })]).size).toBe(0);
  });
});

describe('salesDateSpan', () => {
  it('spans the earliest and latest sale', () => {
    expect(salesDateSpan([
      makeSale({ date: '2026-07-10' }),
      makeSale({ date: '2026-02-01' }),
      makeSale({ date: '2026-07-20' }),
    ])).toEqual({ start: '2026-02-01', end: '2026-07-20' });
  });

  it('is null with no sales at all', () => {
    expect(salesDateSpan([])).toBeNull();
  });
});
