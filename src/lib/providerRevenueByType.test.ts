import { describe, expect, it } from 'vitest';
import { computeProviderRevenueByType, totalRevenueByType, visibleRevenueTypeKeys } from './providerRevenueByType';
import { makeSale } from '../test/fixtures';
import type { DateRange } from './metrics';

const RANGE: DateRange = { start: '2026-07-01', end: '2026-07-31' };
const compute = (rows: Parameters<typeof computeProviderRevenueByType>[0], groups = [], overrides = []) =>
  computeProviderRevenueByType(rows, RANGE, groups, overrides);

describe('computeProviderRevenueByType', () => {
  it('splits a reversal out of the sale column instead of netting it away', () => {
    // Two providers with the same net. Netted, they are indistinguishable; the point of the split
    // is that one sold 500 cleanly and the other sold 900 and had 400 of it handed back.
    const rows = [
      makeSale({ staff: 'Dr A', itemType: 'Service', amount: 500 }),
      makeSale({ staff: 'Dr B', itemType: 'Service', amount: 900 }),
      makeSale({ staff: 'Dr B', itemType: 'Service', amount: -400, qty: -1 }),
    ];
    // Equal net, so the sort is a tie and insertion order stands.
    const [a, b] = compute(rows);
    expect(a).toMatchObject({ provider: 'Dr A', netRevenue: 500 });
    expect(a.amounts.service).toBe(500);
    expect(a.amounts.serviceRefund).toBe(0);
    expect(b).toMatchObject({ provider: 'Dr B', netRevenue: 500 });
    expect(b.amounts.service).toBe(900);
    expect(b.amounts.serviceRefund).toBe(-400);
  });

  it('keeps each item type in its own pair of columns', () => {
    const rows = [
      makeSale({ staff: 'Dr A', itemType: 'Service', amount: 100 }),
      makeSale({ staff: 'Dr A', itemType: 'Product', amount: 60 }),
      makeSale({ staff: 'Dr A', itemType: 'Product', amount: -20, qty: -1 }),
      makeSale({ staff: 'Dr A', itemType: 'Package', amount: 900 }),
      makeSale({ staff: 'Dr A', itemType: 'Package', amount: -300, qty: -1 }),
    ];
    const [row] = compute(rows);
    expect(row.amounts).toMatchObject({
      service: 100, serviceRefund: 0, product: 60, productRefund: -20, package: 900, packageRefund: -300,
    });
    expect(row.netRevenue).toBe(740);
  });

  it('columns sum to net revenue, which is the dashboard Revenue figure', () => {
    const rows = [
      makeSale({ staff: 'Dr A', itemType: 'Service', amount: 250 }),
      makeSale({ staff: 'Dr B', itemType: 'Product', amount: -75, qty: -1 }),
      makeSale({ staff: 'Dr B', itemType: 'Package', amount: 400 }),
    ];
    const total = totalRevenueByType(compute(rows));
    const columnSum = Object.values(total.amounts).reduce((s, v) => s + v, 0);
    expect(columnSum).toBe(575);
    expect(total.netRevenue).toBe(575);
    expect(total.netRevenue).toBe(rows.reduce((s, r) => s + r.amount, 0));
  });

  it('reports package redemption beside revenue, never inside it', () => {
    // A redeemed session is a Service line with no new cash: revenue was recognized when the
    // package was sold, so counting it again here would book the same money twice.
    const rows = [
      makeSale({ staff: 'Dr A', itemType: 'Service', amount: 0, redeemedAmount: 120 }),
      makeSale({ staff: 'Dr A', itemType: 'Service', amount: 80 }),
    ];
    const [row] = compute(rows);
    expect(row.netRevenue).toBe(80);
    expect(row.redeemed).toBe(120);
    expect(row.deliveredValue).toBe(200);
  });

  it('counts a zero-value reversal on the refund side', () => {
    const rows = [makeSale({ staff: 'Dr A', itemType: 'Service', amount: 0, qty: -1 })];
    const [row] = compute(rows);
    expect(row.lines.serviceRefund).toBe(1);
    expect(row.lines.service).toBe(0);
  });

  it('folds an assisting nurse into the doctor she assisted', () => {
    const rows = [
      makeSale({ staff: 'Nurse Reni', itemType: 'Service', amount: 100 }),
      makeSale({ staff: 'Dr Obada', itemType: 'Service', amount: 50 }),
    ];
    const groups = [{ id: 'g1', canonicalName: 'Dr Obada', aliases: ['Nurse Reni'] }];
    const result = computeProviderRevenueByType(rows, RANGE, groups, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ provider: 'Dr Obada', netRevenue: 150 });
  });

  it('files a line with no staff under Unassigned rather than dropping it', () => {
    const [row] = compute([makeSale({ staff: null, amount: 40 })]);
    expect(row.provider).toBe('Unassigned');
    expect(row.netRevenue).toBe(40);
  });

  it('ignores lines outside the period', () => {
    const rows = [
      makeSale({ staff: 'Dr A', amount: 100 }),
      makeSale({ staff: 'Dr A', amount: 999, date: '2026-06-30' }),
    ];
    expect(compute(rows)[0].netRevenue).toBe(100);
  });

  it('ranks providers by net revenue', () => {
    const rows = [
      makeSale({ staff: 'Dr A', amount: 100 }),
      makeSale({ staff: 'Dr B', amount: 300 }),
      makeSale({ staff: 'Dr C', amount: 200 }),
    ];
    expect(compute(rows).map((r) => r.provider)).toEqual(['Dr B', 'Dr C', 'Dr A']);
  });
});

describe('visibleRevenueTypeKeys', () => {
  it('hides the Other columns when nothing landed there', () => {
    const total = totalRevenueByType(compute([makeSale({ staff: 'Dr A', itemType: 'Service', amount: 10 })]));
    expect(visibleRevenueTypeKeys(total)).toEqual([
      'service', 'serviceRefund', 'product', 'productRefund', 'package', 'packageRefund',
    ]);
  });

  it('surfaces an unrecognized item type rather than folding it into one of the three', () => {
    const total = totalRevenueByType(compute([makeSale({ staff: 'Dr A', itemType: 'Membership', amount: 10 })]));
    expect(visibleRevenueTypeKeys(total)).toContain('other');
    expect(total.amounts.other).toBe(10);
  });
});
