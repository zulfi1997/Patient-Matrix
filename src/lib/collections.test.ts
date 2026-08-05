import { describe, expect, it } from 'vitest';
import {
  buildCardOnlyInvoices,
  buildInvoiceProviderShares,
  cashCollectedFor,
  computeProviderCollections,
  invoiceAttributionDetail,
  invoiceNumberRanges,
  needsInvestigation,
  salesDateSpan,
} from './collections';
import { classifyPaymentMethod, isCashCollection, methodOf } from './collectionsParser';
import { makeSale } from '../test/fixtures';
import type { CollectionRecord } from '../types';
import type { DateRange } from './metrics';

const RANGE: DateRange = { start: '2026-07-01', end: '2026-07-31' };

/**
 * A representative raw Payment Type for each bucket, so a fixture that names a method still carries
 * the text the app actually classifies from. Setting one without the other would build a record
 * that could never come out of a real export.
 */
const PAYMENT_TYPE_FOR: Record<CollectionRecord['method'], string> = {
  card: 'Card',
  cash: 'Cash',
  bankTransfer: 'Custom - Bank Transfer',
  other: 'Custom - Void Payment',
  package: 'Package - derma-Custom Package-Someone-20260730183827',
  giftCard: 'Gift Card(2190)',
  prepaidCard: 'Prepaid Card(PR202606103435168179)',
  internalTransfer: 'Custom - Refund - Internal',
};

const payment = (over: Partial<CollectionRecord> = {}): CollectionRecord => {
  const method = over.method ?? 'card';
  return {
    id: 'c1', importBatchId: 'b1', date: '2026-07-10', invoiceNo: 'TBC1',
    patientId: 'MUS1', patientName: 'Test Patient', centerName: 'Main',
    paymentType: PAYMENT_TYPE_FOR[method], method, amount: 100, taxCollected: 0,
    invoiceStatus: 'Closed', collectedBy: 'Cashier', comments: null, ...over,
  };
};

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
    expect(result.totalNetCollected).toBe(100);
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
    expect(result.unattributedCollected).toBe(80);
    expect(result.unattributedPayments).toBe(1);
    // Still in the total, so the file reconciles even where attribution could not.
    expect(result.totalNetCollected).toBe(80);
  });

  it('filters by collection date, not sale date', () => {
    const result = computeProviderCollections([
      payment({ id: 'p1', date: '2026-07-10', amount: 100 }),
      payment({ id: 'p2', date: '2026-08-01', amount: 999 }),
    ], shares(sales()), RANGE);
    expect(result.totalNetCollected).toBe(100);
  });

  it('counts distinct invoices separately from payments, so instalments are visible', () => {
    const result = computeProviderCollections([
      payment({ id: 'p1', invoiceNo: 'TBC1', amount: 60 }),
      payment({ id: 'p2', invoiceNo: 'TBC1', amount: 40 }),
    ], shares(sales()), RANGE);
    expect(result.providers[0]).toMatchObject({ invoices: 1, payments: 2, netCollected: 100 });
  });

  it('keeps a refund negative rather than dropping it', () => {
    const result = computeProviderCollections([
      payment({ id: 'p1', amount: 500 }),
      payment({ id: 'p2', method: 'bankTransfer', amount: -120 }),
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

    const attributed = result.providers.reduce((s, p) => s + p.netCollected, 0);
    expect(attributed).toBe(300);
    expect(result.unattributedCollected).toBe(120);
    expect(result.totalNetCollected).toBe(attributed + result.unattributedCollected + result.unattributedRefunded);
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
    expect(result.unattributedCollected).toBe(0);
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
    expect(result.unattributed.reduce((s, u) => s + u.payment.amount, 0)).toBe(result.unattributedCollected + result.unattributedRefunded + result.unattributedRedemption);
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

describe('refund invoices', () => {
  it('splits a refund by who sold it, not equally between whoever touched it', () => {
    // The regression: every amount on a refund invoice is negative, so clamping weights at zero
    // collapsed them all and the split fell through to counting lines - handing 50/50 to two
    // providers who had sold 93% and 7% of it. A refund is still that provider's money moving.
    const result = shares([
      makeSale({ invoiceNo: 'TBC25204', staff: 'Fatima', itemType: 'Pre-paid card', amount: -117.426, qty: -1 }),
      makeSale({ invoiceNo: 'TBC25204', staff: 'Dr B', amount: -9.261, qty: -1 }),
    ]);
    const [fatima, other] = result.get('TBC25204')!;
    expect(fatima.provider).toBe('Fatima');
    expect(fatima.share).toBeCloseTo(117.426 / 126.687, 6);
    expect(other.share).toBeCloseTo(9.261 / 126.687, 6);
    expect(fatima.share + other.share).toBeCloseTo(1, 9);
  });

  it('gives the whole refund to the only provider on the invoice', () => {
    // "Sold by Fatima, so what is there to split" - nothing, and nothing should happen.
    const result = shares([makeSale({ invoiceNo: 'TBC25204', staff: 'Fatima', amount: -117.426, qty: -1 })]);
    expect(result.get('TBC25204')).toEqual([{ provider: 'Fatima', share: 1 }]);
  });

  it('carries the refund through to the provider as a negative collection', () => {
    const invoiceShares = shares([makeSale({ invoiceNo: 'TBC25204', staff: 'Fatima', amount: -117.426, qty: -1 })]);
    const result = computeProviderCollections(
      [payment({ invoiceNo: 'TBC25204', date: '2026-07-03', method: 'bankTransfer', paymentType: 'Custom - Bank Transfer', amount: -117.426 })],
      invoiceShares,
      RANGE,
    );
    expect(cashCollectedFor(result, 'Fatima')).toBeCloseTo(-117.426, 6);
  });

});

describe('invoiceAttributionDetail', () => {
  it('says outright when nothing was split', () => {
    const invoiceShares = shares([makeSale({ invoiceNo: 'TBC25204', staff: 'Fatima', amount: -117.426 })]);
    const [row] = invoiceAttributionDetail([payment({ invoiceNo: 'TBC25204', amount: -117.426 })], invoiceShares, RANGE);
    expect(row).toMatchObject({ provider: 'Fatima', share: 1, providersOnInvoice: 1, attributed: -117.426 });
  });

  it('lists every provider taking a piece, so a short figure explains itself', () => {
    const invoiceShares = shares([
      makeSale({ invoiceNo: 'TBC1', staff: 'Fatima', amount: 300 }),
      makeSale({ invoiceNo: 'TBC1', staff: 'Dr B', amount: 100 }),
    ]);
    const rows = invoiceAttributionDetail([payment({ invoiceNo: 'TBC1', amount: 400 })], invoiceShares, RANGE);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.provider, r.attributed])).toEqual([['Dr B', 100], ['Fatima', 300]]);
    expect(rows.every((r) => r.providersOnInvoice === 2)).toBe(true);
    expect(rows.reduce((s, r) => s + r.attributed, 0)).toBe(400);
  });
});

describe('blank staff does not dilute a named seller', () => {
  it('gives the whole payment to the named provider when another line has no staff', () => {
    // "If it's blank why does it split" - it should not. A line with no staff recorded is an
    // absence of information, not a claim on the money.
    const result = shares([
      makeSale({ invoiceNo: 'TBC25204', staff: 'Fatima', amount: -117.426 }),
      makeSale({ invoiceNo: 'TBC25204', staff: null, amount: -9.261 }),
    ]);
    expect(result.get('TBC25204')).toEqual([{ provider: 'Fatima', share: 1 }]);
  });

  it('still splits between two named providers', () => {
    const result = shares([
      makeSale({ invoiceNo: 'TBC1', staff: 'Fatima', amount: 300 }),
      makeSale({ invoiceNo: 'TBC1', staff: 'Dr B', amount: 100 }),
    ]);
    expect(result.get('TBC1')).toHaveLength(2);
  });

  it('leaves it with Unassigned when nothing on the invoice has a seller', () => {
    // Visible rather than silently handed to whoever happens to be nearby.
    const result = shares([makeSale({ invoiceNo: 'TBC1', staff: null, amount: 100 })]);
    expect(result.get('TBC1')).toEqual([{ provider: 'Unassigned', share: 1 }]);
  });
});

describe('gift and prepaid card refunds', () => {
  const cardSale = () => makeSale({ invoiceNo: 'TBC25204', staff: 'Fatima', itemType: 'Pre-paid card', amount: -117.426, qty: -1 });
  const refund = () => payment({
    invoiceNo: 'TBC25204', method: 'bankTransfer', paymentType: 'Custom - Bank Transfer', amount: -117.426,
  });
  const compute = (sales: Parameters<typeof shares>[0], payments: CollectionRecord[]) =>
    computeProviderCollections(payments, shares(sales), RANGE, null, new Map(), buildCardOnlyInvoices(sales));

  it('keeps a card refund out of cash collected and in its own figure', () => {
    // The card was paid for in an earlier period, so netting its return against this period's
    // takings would understate what was actually collected here.
    const result = compute([cardSale()], [refund()]);
    expect(result.providers[0].collected).toBe(0);
    expect(result.providers[0].refunded).toBeCloseTo(-117.426, 6);
    expect(result.providers[0].cardRefunds).toBeCloseTo(-117.426, 6);
    expect(result.totalNetCollected).toBeCloseTo(-117.426, 6);
    expect(result.totalCardRefunds).toBeCloseTo(-117.426, 6);
  });

  it('still counts selling the card as cash collected', () => {
    // Only the refund direction is separated; taking money for a card is money arriving.
    const sale = makeSale({ invoiceNo: 'TBC1', staff: 'Fatima', itemType: 'Pre-paid card', amount: 210 });
    const result = compute([sale], [payment({ invoiceNo: 'TBC1', amount: 210 })]);
    expect(cashCollectedFor(result, 'Fatima')).toBe(210);
    expect(result.totalCardRefunds).toBe(0);
  });

  it('leaves a refunded service netting off as before', () => {
    // Only card invoices are separated - refunding a service is this period's money going back out.
    const service = makeSale({ invoiceNo: 'TBC1', staff: 'Fatima', itemType: 'Service', amount: -50 });
    const result = compute([service], [payment({ invoiceNo: 'TBC1', amount: -50 })]);
    expect(cashCollectedFor(result, 'Fatima')).toBe(-50);
    expect(result.totalCardRefunds).toBe(0);
  });

  it('will not treat a mixed invoice as a card movement', () => {
    // A card sold alongside services is not purely a card refund, and guessing which part is would
    // be worse than leaving it in cash where it can at least be reconciled.
    const mixed = [
      makeSale({ invoiceNo: 'TBC1', staff: 'Fatima', itemType: 'Pre-paid card', amount: -100 }),
      makeSale({ invoiceNo: 'TBC1', staff: 'Fatima', itemType: 'Service', amount: -20 }),
    ];
    const result = compute(mixed, [payment({ invoiceNo: 'TBC1', amount: -120 })]);
    expect(result.totalCardRefunds).toBe(0);
    expect(cashCollectedFor(result, 'Fatima')).toBe(-120);
  });
});

describe('manual collection attribution', () => {
  const override = (invoiceNo: string, provider: string) => ({ id: 'o1', invoiceNo, provider, note: '' });

  it('gives the whole payment to the named provider instead of splitting', () => {
    // The escape hatch: when the sales data cannot say who a refund belongs to, saying so by hand
    // beats any rule the app could infer.
    const sales = [
      makeSale({ invoiceNo: 'TBC25204', staff: 'Dr A', amount: -100 }),
      makeSale({ invoiceNo: 'TBC25204', staff: 'Dr B', amount: -100 }),
    ];
    const withOverride = buildInvoiceProviderShares(sales, [], [], [override('TBC25204', 'Fatima')]);
    expect(withOverride.get('TBC25204')).toEqual([{ provider: 'Fatima', share: 1 }]);
  });

  it('attributes an invoice the sales data never mentions', () => {
    const withOverride = buildInvoiceProviderShares([], [], [], [override('TBC99999', 'Fatima')]);
    const result = computeProviderCollections([payment({ invoiceNo: 'TBC99999', amount: 250 })], withOverride, RANGE);
    expect(cashCollectedFor(result, 'Fatima')).toBe(250);
    expect(result.unattributed).toEqual([]);
  });

  it('ignores a blank invoice or provider rather than mapping everything to nothing', () => {
    const sales = [makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 100 })];
    const result = buildInvoiceProviderShares(sales, [], [], [override('  ', 'Fatima'), override('TBC1', '  ')]);
    expect(result.get('TBC1')).toEqual([{ provider: 'Dr A', share: 1 }]);
  });

  it('leaves other invoices alone', () => {
    const sales = [
      makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 100 }),
      makeSale({ invoiceNo: 'TBC2', staff: 'Dr B', amount: 100 }),
    ];
    const result = buildInvoiceProviderShares(sales, [], [], [override('TBC1', 'Fatima')]);
    expect(result.get('TBC1')).toEqual([{ provider: 'Fatima', share: 1 }]);
    expect(result.get('TBC2')).toEqual([{ provider: 'Dr B', share: 1 }]);
  });
});

describe('collection, refund and net', () => {
  it('keeps money in and money out apart, and adds them for the net', () => {
    const sales = [makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 500 })];
    const result = computeProviderCollections([
      payment({ id: 'p1', invoiceNo: 'TBC1', amount: 500 }),
      payment({ id: 'p2', invoiceNo: 'TBC1', amount: -120 }),
    ], shares(sales), RANGE);
    expect(result.providers[0]).toMatchObject({ collected: 500, refunded: -120, netCollected: 380 });
    expect(result.totalCollected).toBe(500);
    expect(result.totalRefunded).toBe(-120);
    expect(result.totalNetCollected).toBe(380);
  });

  it('adds up across providers and unattributed alike', () => {
    const sales = [makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 500 })];
    const result = computeProviderCollections([
      payment({ id: 'p1', invoiceNo: 'TBC1', amount: 500 }),
      payment({ id: 'p2', invoiceNo: 'GONE', amount: -120 }),
    ], shares(sales), RANGE);
    const attributed = result.providers.reduce((s, p) => s + p.netCollected, 0);
    expect(result.totalNetCollected).toBe(attributed + result.unattributedCollected + result.unattributedRefunded);
  });
});

describe('internal transfers are neither collection nor refund', () => {
  it('leaves both legs out, so Refund shows only money that left the clinic', () => {
    // Real June rows: TBC26095 -104.850 and TBC26094 +104.850, same patient, same day. Counting the
    // negative leg as a refund overstated June's refunds by 2,767.305 against the clinic's own
    // figure of 1,459.274, and the positive leg overstated Collection by the same amount.
    const sales = [
      makeSale({ invoiceNo: 'TBC26094', staff: 'Dr A', amount: 104.85 }),
      makeSale({ invoiceNo: 'TBC26095', staff: 'Dr A', amount: 104.85 }),
      makeSale({ invoiceNo: 'TBC1', staff: 'Dr A', amount: 500 }),
    ];
    const result = computeProviderCollections([
      payment({ id: 'p1', invoiceNo: 'TBC1', amount: 500 }),
      payment({ id: 'p2', invoiceNo: 'TBC1', method: 'bankTransfer', paymentType: 'Custom - Bank Transfer', amount: -80 }),
      payment({ id: 'p3', invoiceNo: 'TBC26095', method: 'internalTransfer', paymentType: 'Custom - Refund - Internal', amount: -104.85 }),
      payment({ id: 'p4', invoiceNo: 'TBC26094', method: 'internalTransfer', paymentType: 'Custom - Refund - Internal', amount: 104.85 }),
    ], shares(sales), RANGE);

    expect(result.totalCollected).toBe(500);
    expect(result.totalRefunded).toBe(-80);
    expect(result.totalNetCollected).toBe(420);
    // Reported rather than dropped: the pair is counted once, not twice.
    expect(result.totalInternalTransferred).toBeCloseTo(104.85, 6);
  });

  it('classifies the payment type Zenoti uses for it', () => {
    expect(classifyPaymentMethod('Custom - Refund - Internal')).toBe('internalTransfer');
    expect(isCashCollection('internalTransfer')).toBe(false);
  });

  it('still treats a bank-transfer refund as a real refund', () => {
    // The distinction is the point: one moves money between two of the clinic's own invoices, the
    // other hands it back to the patient.
    expect(classifyPaymentMethod('Custom - Bank Transfer')).toBe('bankTransfer');
    expect(classifyPaymentMethod('Custom - Bank Transfer - Bank Muscat')).toBe('bankTransfer');
  });
});

describe('classification is derived, never read back from storage', () => {
  it('reclassifies a row imported under an older rule', () => {
    // The regression: method is written once at import and then lives in IndexedDB. Splitting
    // internal transfers out of refunds changed the rule but not the stored rows, so the fix
    // reached nobody who had already imported their collections - the figures simply did not move.
    const stale = payment({
      invoiceNo: 'TBC26095',
      paymentType: 'Custom - Refund - Internal',
      method: 'other', // what the old parser wrote
      amount: -104.85,
    });
    const sales = [makeSale({ invoiceNo: 'TBC26095', staff: 'Dr A', amount: 104.85 })];
    const result = computeProviderCollections([stale], shares(sales), RANGE);
    expect(result.totalRefunded).toBe(0);
    expect(result.totalInternalTransferred).toBeCloseTo(52.425, 6);
  });

  it('reads the payment type over the stored method wherever they disagree', () => {
    expect(methodOf({ paymentType: 'Custom - Refund - Internal', method: 'other' })).toBe('internalTransfer');
    expect(methodOf({ paymentType: 'Gift Card(2190)', method: 'card' })).toBe('giftCard');
  });

  it('falls back to the stored method when there is no payment type to read', () => {
    expect(methodOf({ paymentType: '', method: 'bankTransfer' })).toBe('bankTransfer');
  });
});
