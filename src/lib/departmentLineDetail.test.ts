import { describe, expect, it } from 'vitest';
import {
  buildBenefitLookup,
  buildServiceDepartmentMap,
  computeDepartmentLineDetail,
  computeDepartmentProviderContribution,
  UNMAPPED,
} from './departmentAnalytics';
import { makeSale } from '../test/fixtures';
import type { PackageBenefitRecord } from '../types';
import type { ServiceDepartmentRecord } from './departments';
import type { DateRange } from './metrics';

const RANGE: DateRange = { start: '2026-07-01', end: '2026-07-31' };

const MAPPED: ServiceDepartmentRecord[] = [
  { serviceKey: 'code:F1', serviceName: 'Facial Deluxe', department: 'Facial' },
  { serviceKey: 'code:L1', serviceName: 'Laser Full', department: 'Laser' },
];

const benefit = (benefitName: string, value: number): PackageBenefitRecord =>
  ({
    id: `PKG1-${benefitName}`, snapshotDate: '2026-07-01', saleCenter: 'Main', invoiceNo: 'PKG1',
    packageCode: null, packageName: 'Mixed Pkg', packageCategory: 'Derma', guestName: 'A',
    benefitType: 'Service', benefitName, accruedQty: 1, value, redeemedQty: 0, redeemedValue: 0,
    balanceQty: 1, packageStatus: 'Active',
  }) as PackageBenefitRecord;

const lookup = () => buildBenefitLookup([benefit('Facial Deluxe', 300), benefit('Laser Full', 100)], MAPPED);
const mapping = () => buildServiceDepartmentMap(MAPPED);

const detail = (records: Parameters<typeof computeDepartmentLineDetail>[0], groups = [], overrides = []) =>
  computeDepartmentLineDetail(records, RANGE, mapping(), lookup(), groups, overrides);

const mixedPackage = () =>
  makeSale({
    staff: 'Dr A', itemType: 'Package', invoiceNo: 'PKG1', serviceKey: 'code:PKG',
    serviceName: 'Mixed Pkg', amount: 400, date: '2026-07-10', patientId: 'P1', patientName: 'Amal',
  });

describe('computeDepartmentLineDetail', () => {
  it('emits one row per department a mixed package spans, split by benefit value', () => {
    const rows = detail([mixedPackage()]);
    expect(rows.map((r) => r.department)).toEqual(['Facial', 'Laser']);
    // 300/400 and 100/400 of the benefit value, applied to the 400 the package sold for.
    expect(rows.find((r) => r.department === 'Facial')!.revenue).toBeCloseTo(300, 6);
    expect(rows.find((r) => r.department === 'Laser')!.revenue).toBeCloseTo(100, 6);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 6);
  });

  it('keeps the whole line beside its share, so a partial row reconciles to the invoice', () => {
    for (const row of detail([mixedPackage()])) {
      expect(row.lineRevenue).toBe(400);
      expect(row.revenue).toBeCloseTo(row.lineRevenue * row.share, 6);
    }
  });

  it('sums back to the Departments summary the export sits behind', () => {
    const records = [
      mixedPackage(),
      makeSale({ staff: 'Dr A', serviceKey: 'code:F1', serviceName: 'Facial Deluxe', amount: 50, date: '2026-07-12' }),
    ];
    const summary = computeDepartmentProviderContribution(records, RANGE, mapping(), lookup(), [], []);
    const rows = detail(records);
    for (const s of summary) {
      const mine = rows.filter((r) => r.department === s.department && r.provider === s.provider);
      expect(mine.reduce((sum, r) => sum + r.revenue, 0)).toBeCloseTo(s.revenue, 6);
      expect(mine.reduce((sum, r) => sum + r.transactions, 0)).toBe(s.transactions);
    }
  });

  it('says how each department was decided', () => {
    const records = [
      makeSale({ staff: 'Dr A', serviceKey: 'code:F1', serviceName: 'Facial Deluxe', amount: 50 }),
      mixedPackage(),
      makeSale({ staff: 'Dr A', serviceKey: 'code:ZZ', serviceName: 'Something New', amount: 10 }),
    ];
    const basisFor = (service: string) => detail(records).find((r) => r.serviceName === service)!.basis;
    expect(basisFor('Facial Deluxe')).toBe('mapped');
    expect(basisFor('Mixed Pkg')).toBe('packageBenefits');
    expect(basisFor('Something New')).toBe('unmapped');
    expect(detail(records).find((r) => r.serviceName === 'Something New')!.department).toBe(UNMAPPED);
  });

  it('reports a redeemed session beside revenue, not inside it', () => {
    const rows = detail([
      makeSale({
        staff: 'Dr A', serviceKey: 'code:F1', serviceName: 'Facial Deluxe',
        amount: 0, redeemedAmount: 120, packageName: 'Derma Custom Package',
      }),
    ]);
    expect(rows[0]).toMatchObject({ revenue: 0, redeemed: 120, deliveredValue: 120, packageName: 'Derma Custom Package' });
  });

  it('resolves the provider and keeps the raw name beside it', () => {
    const groups = [{ id: 'g1', canonicalName: 'Dr Obada', aliases: ['Nurse Reni'] }];
    const rows = computeDepartmentLineDetail(
      [makeSale({ staff: 'Nurse Reni', serviceKey: 'code:F1', serviceName: 'Facial Deluxe', amount: 50 })],
      RANGE, mapping(), lookup(), groups, [],
    );
    expect(rows[0]).toMatchObject({ provider: 'Dr Obada', rawStaff: 'Nurse Reni' });
  });

  it('ignores lines outside the period', () => {
    const rows = detail([makeSale({ staff: 'Dr A', serviceKey: 'code:F1', serviceName: 'Facial Deluxe', amount: 50, date: '2026-06-30' })]);
    expect(rows).toEqual([]);
  });
});
