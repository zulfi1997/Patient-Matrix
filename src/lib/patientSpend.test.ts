import { describe, expect, it } from 'vitest';
import {
  computePatientSpend,
  spendConcentration,
  spendOf,
  topSpenders,
  type SpendBasis,
} from './patientSpend';
import { summarizePatients, type DateRange } from './metrics';
import { makeSale } from '../test/fixtures';
import type { CollectionRecord, SaleRecord } from '../types';

const JUNE: DateRange = { start: '2026-06-01', end: '2026-06-30' };

const build = (rows: SaleRecord[], groups = [], overrides = []) =>
  computePatientSpend(rows, JUNE, summarizePatients(rows), groups, overrides);

const find = (rows: SaleRecord[], id: string) => build(rows).patients.find((p) => p.patientId === id)!;

describe('computePatientSpend', () => {
  it('adds up what a patient spent across several visits', () => {
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-06-02', amount: 300, invoiceNo: 'A' }),
      makeSale({ patientId: 'P1', date: '2026-06-02', amount: 200, invoiceNo: 'A' }),
      makeSale({ patientId: 'P1', date: '2026-06-20', amount: 500, invoiceNo: 'B' }),
    ];
    expect(find(rows, 'P1')).toMatchObject({
      revenue: 1000, visits: 2, invoices: 2, lastVisit: '2026-06-20',
    });
  });

  it('keeps cash and package-delivered value apart', () => {
    // The same patient can be the month's biggest spender on one basis and unremarkable on the
    // other. Netting them together would hide which it is.
    const rows = [
      makeSale({ patientId: 'BUYER', date: '2026-06-02', itemType: 'Package', amount: 5000 }),
      makeSale({ patientId: 'USER', date: '2026-06-03', amount: 0, redeemedAmount: 900, packageName: 'Pkg' }),
    ];
    expect(find(rows, 'BUYER')).toMatchObject({ revenue: 5000, redeemed: 0, deliveredValue: 5000 });
    expect(find(rows, 'USER')).toMatchObject({ revenue: 0, redeemed: 900, deliveredValue: 900 });
  });

  it('ignores spend outside the period', () => {
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-06-10', amount: 100 }),
      makeSale({ patientId: 'P1', date: '2026-05-31', amount: 9999 }),
    ];
    expect(find(rows, 'P1').revenue).toBe(100);
  });

  it('subtracts a refund from the spender it was given back to', () => {
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-06-02', amount: 1000 }),
      makeSale({ patientId: 'P1', date: '2026-06-20', amount: -400, qty: -1 }),
    ];
    expect(find(rows, 'P1').revenue).toBe(600);
  });

  it('names the provider who earned most of the patient, and how much of them they hold', () => {
    const rows = [
      makeSale({ patientId: 'P1', staff: 'Dr A', date: '2026-06-02', amount: 800 }),
      makeSale({ patientId: 'P1', staff: 'Dr B', date: '2026-06-09', amount: 200 }),
    ];
    expect(find(rows, 'P1')).toMatchObject({ topProvider: 'Dr A', providerCount: 2, topProviderShare: 80 });
  });

  it('credits a provider for package sessions they delivered, not only for cash they took', () => {
    // Dr B sold nothing but spent the month working through the package Dr A sold. Ranking on cash
    // alone would say Dr B never treated this patient.
    const rows = [
      makeSale({ patientId: 'P1', staff: 'Dr A', date: '2026-06-02', itemType: 'Package', amount: 400 }),
      makeSale({ patientId: 'P1', staff: 'Dr B', date: '2026-06-10', amount: 0, redeemedAmount: 900, packageName: 'Pkg' }),
    ];
    expect(find(rows, 'P1').topProvider).toBe('Dr B');
  });

  it('folds an assisting nurse into the doctor she assisted', () => {
    const rows = [
      makeSale({ patientId: 'P1', staff: 'Nurse Reni', date: '2026-06-02', amount: 500 }),
      makeSale({ patientId: 'P1', staff: 'Dr Obada', date: '2026-06-03', amount: 100 }),
    ];
    const groups = [{ id: 'g1', canonicalName: 'Dr Obada', aliases: ['Nurse Reni'] }];
    const [p] = computePatientSpend(rows, JUNE, summarizePatients(rows), groups, []).patients;
    expect(p).toMatchObject({ topProvider: 'Dr Obada', providerCount: 1, topProviderShare: 100 });
  });

  it('carries first visit and lifetime spend from history, not from the period', () => {
    // So a list of big spenders says at a glance which are long-standing and which arrived this
    // month - a different conversation in each case.
    const rows = [
      makeSale({ patientId: 'P1', date: '2025-11-02', amount: 2000 }),
      makeSale({ patientId: 'P1', date: '2026-06-10', amount: 500 }),
    ];
    expect(find(rows, 'P1')).toMatchObject({ firstVisit: '2025-11-02', lifetimeRevenue: 2500, revenue: 500 });
  });

  it('totals the period across everyone, so a share can be taken of it', () => {
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-06-02', amount: 600, redeemedAmount: 100, packageName: 'X' }),
      makeSale({ patientId: 'P2', date: '2026-06-03', amount: 400 }),
    ];
    const summary = build(rows);
    expect(summary).toMatchObject({ totalRevenue: 1000, totalDeliveredValue: 1100, totalPatients: 2 });
  });
});

describe('topSpenders', () => {
  const rows = () => [
    makeSale({ patientId: 'BIG', date: '2026-06-02', amount: 900 }),
    makeSale({ patientId: 'MID', date: '2026-06-03', amount: 500 }),
    makeSale({ patientId: 'SMALL', date: '2026-06-04', amount: 100 }),
    makeSale({ patientId: 'PKG', date: '2026-06-05', amount: 0, redeemedAmount: 700, packageName: 'X' }),
  ];

  it('ranks by cash when that is the basis', () => {
    expect(topSpenders(build(rows()), 'revenue', 3).map((p) => p.patientId)).toEqual(['BIG', 'MID', 'SMALL']);
  });

  it('reorders once package sessions count, and brings in a patient cash never saw', () => {
    expect(topSpenders(build(rows()), 'deliveredValue', 3).map((p) => p.patientId)).toEqual(['BIG', 'PKG', 'MID']);
  });

  it('returns everyone when the limit exceeds the list', () => {
    expect(topSpenders(build(rows()), 'revenue', 99)).toHaveLength(4);
  });

  it('does not reorder the caller’s own list', () => {
    const summary = build(rows());
    const before = summary.patients.map((p) => p.patientId);
    topSpenders(summary, 'deliveredValue', 2);
    expect(summary.patients.map((p) => p.patientId)).toEqual(before);
  });
});

describe('spendConcentration', () => {
  const rows = [
    makeSale({ patientId: 'BIG', date: '2026-06-02', amount: 700 }),
    makeSale({ patientId: 'A', date: '2026-06-03', amount: 200 }),
    makeSale({ patientId: 'B', date: '2026-06-04', amount: 100 }),
  ];

  it('says what share of the period the listed patients carry', () => {
    const summary = computePatientSpend(rows, JUNE, summarizePatients(rows), [], []);
    expect(spendConcentration(summary, topSpenders(summary, 'revenue', 1), 'revenue')).toBeCloseTo(70, 6);
    expect(spendConcentration(summary, topSpenders(summary, 'revenue', 3), 'revenue')).toBeCloseTo(100, 6);
  });

  it('withholds a share rather than dividing by nothing', () => {
    const empty = computePatientSpend([], JUNE, new Map(), [], []);
    expect(spendConcentration(empty, [], 'revenue')).toBeNull();
  });

  it('holds on both bases', () => {
    const withPackage = [...rows, makeSale({ patientId: 'PKG', date: '2026-06-05', amount: 0, redeemedAmount: 1000, packageName: 'X' })];
    const summary = computePatientSpend(withPackage, JUNE, summarizePatients(withPackage), [], []);
    for (const basis of ['revenue', 'deliveredValue'] as SpendBasis[]) {
      const all = topSpenders(summary, basis, 99);
      expect(spendConcentration(summary, all, basis)).toBeCloseTo(100, 6);
      expect(all.reduce((s, p) => s + spendOf(p, basis), 0)).toBeCloseTo(
        basis === 'revenue' ? summary.totalRevenue : summary.totalDeliveredValue, 6,
      );
    }
  });
});

/**
 * What reaches the list and what never does. The spend calculation itself applies no item-type
 * filter at all - everything that happens to a patient counts - so the only omissions are the ones
 * the caller has already made before handing the records over.
 */
describe('which purchases count towards a patient’s spend', () => {
  it('counts services, products, packages and anything else alike', () => {
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-06-02', itemType: 'Service', serviceName: 'HydraFacial', amount: 100 }),
      makeSale({ patientId: 'P1', date: '2026-06-03', itemType: 'Product', serviceName: 'Serum', amount: 45 }),
      makeSale({ patientId: 'P1', date: '2026-06-04', itemType: 'Package', serviceName: 'Filler Pkg', amount: 900 }),
      makeSale({ patientId: 'P1', date: '2026-06-05', itemType: 'Membership', serviceName: 'Gold', amount: 200 }),
    ];
    expect(find(rows, 'P1').revenue).toBe(1245);
  });

  it('counts a product bought on its own, with no service that day', () => {
    const rows = [makeSale({ patientId: 'P1', date: '2026-06-02', itemType: 'Product', amount: 60 })];
    expect(find(rows, 'P1')).toMatchObject({ revenue: 60, visits: 1 });
  });

  it('counts a service settled by gift or prepaid card in full', () => {
    // The card purchase is dropped upstream because it is a means of payment, but the treatment it
    // later pays for is a real sale and must appear against the patient who received it.
    const rows = [makeSale({ patientId: 'P1', date: '2026-06-02', itemType: 'Service', amount: 500, paymentType: 'Gift Card(2190)' })];
    expect(find(rows, 'P1').revenue).toBe(500);
  });

  it('loses a paid service when the YB111 toggle has already removed it', () => {
    // The one omission worth knowing about: that toggle removes whole rows before this runs, so a
    // high spender whose purchases are flagged reads low through no fault of the ranking.
    const rows = [
      makeSale({ patientId: 'P1', date: '2026-06-02', amount: 400 }),
      makeSale({ patientId: 'P1', date: '2026-06-03', amount: 600, invoiceNotes: 'YB111 correction' }),
    ];
    expect(find(rows, 'P1').revenue).toBe(1000);
    const kept = rows.filter((r) => !r.invoiceNotes?.includes('YB111'));
    expect(find(kept, 'P1').revenue).toBe(400);
  });
});

/**
 * What the Revenue column is, and what it is not. It was briefly labelled "Cash", which invited
 * exactly the wrong reading: it is recognized value, and money received is a separate question the
 * Collections import answers.
 */
describe('revenue is recognized value, not money received', () => {
  it('counts a treatment settled by a gift or prepaid card in full', () => {
    // The card purchase was never revenue, so this invoice is the sale - even though the money
    // reached the clinic whenever the card was bought.
    const rows = [makeSale({ patientId: 'P1', date: '2026-06-02', amount: 700, paymentType: 'Prepaid Card(PR2026)' })];
    expect(find(rows, 'P1').revenue).toBe(700);
  });

  it('counts an invoice that has not been paid at all', () => {
    const rows = [makeSale({ patientId: 'P1', date: '2026-06-02', amount: 500, dueAmount: 500 })];
    expect(find(rows, 'P1').revenue).toBe(500);
  });

  it('counts nothing for a package session, however much work it was', () => {
    // The mirror image: real money, banked earlier, and none of it lands in Revenue now.
    const rows = [makeSale({ patientId: 'P1', date: '2026-06-02', amount: 0, redeemedAmount: 800, packageName: 'Pkg' })];
    expect(find(rows, 'P1')).toMatchObject({ revenue: 0, redeemed: 800, deliveredValue: 800 });
  });
});

const payment = (over: Partial<CollectionRecord> = {}): CollectionRecord => ({
  id: `c${Math.random()}`, importBatchId: 'b1', date: '2026-06-10', invoiceNo: 'INV-1',
  patientId: 'P1', patientName: 'Test Patient', centerName: 'Main',
  paymentType: 'Cash', method: 'cash', amount: 100, taxCollected: 0,
  invoiceStatus: 'Closed', collectedBy: 'Reception', comments: null, ...over,
});

describe('money actually collected from each patient', () => {
  const sales = () => [makeSale({ patientId: 'P1', date: '2026-06-02', amount: 1000 })];
  const withPayments = (payments: CollectionRecord[], rows = sales()) =>
    computePatientSpend(rows, JUNE, summarizePatients(rows), [], [], payments).patients.find((p) => p.patientId === 'P1')!;

  it('adds up what the patient actually paid in the period', () => {
    const row = withPayments([payment({ amount: 400 }), payment({ amount: 250, paymentType: 'Credit Card', method: 'card' })]);
    expect(row).toMatchObject({ collected: 650, refunded: 0, netCollected: 650, revenue: 1000 });
  });

  it('nets a refund off without hiding that it happened', () => {
    const row = withPayments([payment({ amount: 400 }), payment({ amount: -150, paymentType: 'Custom - Bank Transfer', method: 'bankTransfer' })]);
    expect(row).toMatchObject({ collected: 400, refunded: -150, netCollected: 250 });
  });

  it('leaves package, gift-card and prepaid settlements out, since that money came in earlier', () => {
    const row = withPayments([
      payment({ amount: 400 }),
      payment({ amount: 300, paymentType: 'Package - Derma', method: 'package' }),
      payment({ amount: 200, paymentType: 'Gift Card(2190)', method: 'giftCard' }),
      payment({ amount: 100, paymentType: 'Prepaid Card(PR2026)', method: 'prepaidCard' }),
    ]);
    expect(row.collected).toBe(400);
  });

  it('leaves an internal transfer out, having never left the clinic', () => {
    const row = withPayments([payment({ amount: 400 }), payment({ amount: -50, paymentType: 'Custom - Refund - Internal', method: 'internalTransfer' })]);
    expect(row).toMatchObject({ collected: 400, refunded: 0 });
  });

  it('ignores a payment made outside the period', () => {
    expect(withPayments([payment({ amount: 400 }), payment({ amount: 900, date: '2026-07-02' })]).collected).toBe(400);
  });

  it('counts a payment in the period against an invoice billed earlier', () => {
    // Instalments: the money arrived in June, so June is where it is reported, whatever month the
    // treatment was sold in. This is why collected will not tie to revenue.
    const row = withPayments([payment({ amount: 400, invoiceNo: 'OLD-INVOICE' })]);
    expect(row).toMatchObject({ collected: 400, revenue: 1000 });
  });

  it('reports zero, not nothing, for a patient who paid nothing while a report was loaded', () => {
    expect(withPayments([payment({ patientId: 'SOMEONE-ELSE' })])).toMatchObject({ collected: 0, netCollected: 0 });
  });

  it('withholds the figure entirely when no Collections export has been imported', () => {
    // A blank cell and a zero say different things, and conflating them would have someone chasing
    // a patient who has in fact paid.
    const rows = sales();
    const row = computePatientSpend(rows, JUNE, summarizePatients(rows), [], []).patients[0];
    expect(row).toMatchObject({ collected: null, refunded: null, netCollected: null });
  });
});
