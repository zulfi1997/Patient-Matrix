import { describe, expect, it } from 'vitest';
import { buildBenefitLookup, computeDepartmentRevenue, UNMAPPED } from './departmentAnalytics';
import { makeSale } from '../test/fixtures';
import type { PackageBenefitRecord } from '../types';
import type { ServiceDepartmentRecord } from './departments';
import type { DateRange } from './metrics';

const RANGE: DateRange = { start: '2026-07-01', end: '2026-07-31' };
const PREV: DateRange = { start: '2026-06-01', end: '2026-06-30' };

const benefit = (benefitName: string, value: number, invoiceNo = 'PKG1'): PackageBenefitRecord =>
  ({
    id: `${invoiceNo}-${benefitName}`,
    snapshotDate: '2026-07-01',
    saleCenter: 'Main',
    invoiceNo,
    packageCode: null,
    packageName: 'Mixed Pkg',
    packageCategory: 'Derma',
    guestName: 'A',
    benefitType: 'Service',
    benefitName,
    accruedQty: 1,
    value,
    redeemedQty: 0,
    redeemedValue: 0,
    balanceQty: 1,
    packageStatus: 'Active',
  }) as PackageBenefitRecord;

const mapped: ServiceDepartmentRecord[] = [
  { serviceKey: 'code:F1', serviceName: 'Facial Deluxe', department: 'Facial' },
  { serviceKey: 'code:F2', serviceName: 'Facial Express', department: 'Facial' },
  { serviceKey: 'code:L1', serviceName: 'Laser Full', department: 'Laser' },
];

const pkgSale = () =>
  makeSale({ itemType: 'Package', invoiceNo: 'PKG1', serviceKey: 'code:PKG', serviceName: 'Mixed Pkg', amount: 300, date: '2026-07-10' });

const rowFor = (dept: string, rows: ReturnType<typeof computeDepartmentRevenue>) => rows.find((r) => r.department === dept);

/**
 * A bundled service counts the same as buying that service on its own: one transaction each. The
 * unit is the service, not the session - a "3 Sessions" service sold directly is a single line and
 * so stays a single transaction inside a package too.
 */
describe('computeDepartmentRevenue transaction counting', () => {
  it('counts one transaction per constituent service, not per department', () => {
    // Two Facial services + one Laser service bundled = 3 transactions, as if sold separately.
    const lookup = buildBenefitLookup([benefit('Facial Deluxe', 100), benefit('Facial Express', 100), benefit('Laser Full', 100)], mapped);
    const rows = computeDepartmentRevenue([pkgSale()], RANGE, PREV, {}, lookup);
    expect(rowFor('Facial', rows)?.transactions).toBe(2);
    expect(rowFor('Laser', rows)?.transactions).toBe(1);
    expect(rows.reduce((s, r) => s + r.transactions, 0)).toBe(3);
  });

  it('still splits revenue by value share, independently of the counts', () => {
    const lookup = buildBenefitLookup([benefit('Facial Deluxe', 100), benefit('Facial Express', 100), benefit('Laser Full', 100)], mapped);
    const rows = computeDepartmentRevenue([pkgSale()], RANGE, PREV, {}, lookup);
    expect(rowFor('Facial', rows)?.revenue).toBeCloseTo(200, 6);
    expect(rowFor('Laser', rows)?.revenue).toBeCloseTo(100, 6);
    expect(rows.reduce((s, r) => s + r.revenue, 0)).toBeCloseTo(300, 6);
  });

  it('counts sessions of one service once, matching how it would sell on its own', () => {
    // Three sessions of a single service is still one service - one line, one transaction.
    const lookup = buildBenefitLookup(
      [benefit('Facial Deluxe', 100), benefit('Facial Deluxe', 100), benefit('Facial Deluxe', 100)],
      mapped,
    );
    const rows = computeDepartmentRevenue([pkgSale()], RANGE, PREV, {}, lookup);
    expect(rowFor('Facial', rows)?.transactions).toBe(1);
    expect(rowFor('Facial', rows)?.revenue).toBeCloseTo(300, 6);
  });

  it('counts an ordinary directly-mapped line once', () => {
    const lookup = buildBenefitLookup([], mapped);
    const sale = makeSale({ serviceKey: 'code:F1', serviceName: 'Facial Deluxe', amount: 80, date: '2026-07-10' });
    const rows = computeDepartmentRevenue([sale], RANGE, PREV, { 'code:F1': 'Facial' }, lookup);
    expect(rowFor('Facial', rows)).toMatchObject({ transactions: 1, revenue: 80 });
  });

  it('counts a package whose services are all one department once per service', () => {
    const lookup = buildBenefitLookup([benefit('Facial Deluxe', 150), benefit('Facial Express', 150)], mapped);
    const rows = computeDepartmentRevenue([pkgSale()], RANGE, PREV, {}, lookup);
    expect(rows).toHaveLength(1);
    expect(rowFor('Facial', rows)).toMatchObject({ transactions: 2, revenue: 300 });
  });

  it('counts an unresolvable package once, under Unmapped', () => {
    const lookup = buildBenefitLookup([], mapped);
    const rows = computeDepartmentRevenue([pkgSale()], RANGE, PREV, {}, lookup);
    expect(rowFor(UNMAPPED, rows)).toMatchObject({ transactions: 1, revenue: 300 });
  });

  it('sends a benefit with no department mapping to Unmapped, still one per service', () => {
    const lookup = buildBenefitLookup([benefit('Facial Deluxe', 100), benefit('Mystery Treatment', 100)], mapped);
    const rows = computeDepartmentRevenue([pkgSale()], RANGE, PREV, {}, lookup);
    expect(rowFor('Facial', rows)?.transactions).toBe(1);
    expect(rowFor(UNMAPPED, rows)?.transactions).toBe(1);
  });
});
