import { describe, expect, it } from 'vitest';
import { computeFlaggedByStaff, computeFlaggedSummary, computeFlaggedTransactions, type DateRange } from './metrics';
import { resolveProvider, type ProviderAssignmentOverride, type ProviderGroup } from './conversionMetrics';
import { makeSale } from '../test/fixtures';
import type { SaleRecord } from '../types';

const RANGE: DateRange = { start: '2026-07-01', end: '2026-07-31' };

const GROUPS: ProviderGroup[] = [{ id: 'g1', canonicalName: 'Dr Obada', aliases: ['Anuja Renchu', 'Rini Antony'] }];

const resolver = (groups: ProviderGroup[] = GROUPS, overrides: ProviderAssignmentOverride[] = []) =>
  (r: SaleRecord) => resolveProvider(r.staff, r.date, groups, overrides);

const flagged = (over: Partial<SaleRecord> = {}) => makeSale({ invoiceNotes: 'YB111 case', ...over });

describe('YB111 breakdown by staff', () => {
  it('counts an assisting nurse under the doctor she assists', () => {
    // The regression: this tab read the raw name on the line, so nurses appeared as providers of
    // their own here while every other tab folded them into their doctor.
    const rows = [
      flagged({ staff: 'Anuja Renchu', amount: 100 }),
      flagged({ staff: 'Rini Antony', amount: 40 }),
      flagged({ staff: 'Dr Obada', amount: 60 }),
    ];
    const byStaff = computeFlaggedByStaff(rows, RANGE, resolver());
    expect(byStaff).toHaveLength(1);
    expect(byStaff[0]).toMatchObject({ key: 'Dr Obada', count: 3, amount: 200 });
  });

  it('still reads the raw name when no resolver is given', () => {
    const rows = [flagged({ staff: 'Anuja Renchu', amount: 100 }), flagged({ staff: 'Dr Obada', amount: 60 })];
    expect(computeFlaggedByStaff(rows, RANGE).map((s) => s.key)).toEqual(['Anuja Renchu', 'Dr Obada']);
  });

  it('lets a date-scoped override win over the permanent group', () => {
    // Covering for a doctor on leave: the same nurse counts under a different doctor for those days.
    const overrides: ProviderAssignmentOverride[] = [
      { id: 'o1', staffName: 'Anuja Renchu', canonicalName: 'Dr Fatima', startDate: '2026-07-10', endDate: '2026-07-12', note: 'covering leave' },
    ];
    const rows = [
      flagged({ staff: 'Anuja Renchu', date: '2026-07-11', amount: 100 }),
      flagged({ staff: 'Anuja Renchu', date: '2026-07-20', amount: 50 }),
    ];
    const byStaff = computeFlaggedByStaff(rows, RANGE, resolver(GROUPS, overrides));
    // Equal line counts, so the sort is a tie and the earlier date leads.
    expect(byStaff.map((s) => [s.key, s.amount])).toEqual([['Dr Fatima', 100], ['Dr Obada', 50]]);
  });

  it('collapses the distinct-staff count the same way', () => {
    const rows = [flagged({ staff: 'Anuja Renchu' }), flagged({ staff: 'Rini Antony' }), flagged({ staff: 'Dr Obada' })];
    expect(computeFlaggedSummary(rows, RANGE, resolver()).distinctStaff).toBe(1);
    expect(computeFlaggedSummary(rows, RANGE).distinctStaff).toBe(3);
  });

  it('keeps the name on the line beside the resolved one, so a row can be traced back', () => {
    const [t] = computeFlaggedTransactions([flagged({ staff: 'Anuja Renchu' })], RANGE, resolver());
    expect(t.staff).toBe('Dr Obada');
    expect(t.rawStaff).toBe('Anuja Renchu');
  });

  it('files a flagged line with no staff under Unassigned, as the other tabs label it', () => {
    expect(computeFlaggedByStaff([flagged({ staff: null })], RANGE, resolver())[0].key).toBe('Unassigned');
  });

  it('ignores unflagged lines and lines outside the period', () => {
    const rows = [
      flagged({ staff: 'Dr Obada', amount: 100 }),
      makeSale({ staff: 'Dr Obada', amount: 999, invoiceNotes: null }),
      flagged({ staff: 'Dr Obada', amount: 999, date: '2026-06-30' }),
    ];
    expect(computeFlaggedByStaff(rows, RANGE, resolver())[0]).toMatchObject({ count: 1, amount: 100 });
  });
});
