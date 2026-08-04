import { describe, expect, it } from 'vitest';
import { computeDormantServices, computeServiceStats } from './metrics';
import { makeSale } from '../test/fixtures';
import type { DateRange } from './metrics';

const RANGE: DateRange = { start: '2026-07-01', end: '2026-07-31' };

/**
 * A package session being consumed arrives as an Item Type = Service line (the service actually
 * performed), with the package on Payment Type: amount 0, redeemedAmount carrying the value.
 */
const redemption = (over: Parameters<typeof makeSale>[0] = {}) =>
  makeSale({ amount: 0, redeemedAmount: 100, packageName: 'Derma Custom Package', ...over });

describe('computeServiceStats', () => {
  it('keeps revenue as new cash only', () => {
    const rows = [makeSale({ serviceKey: 'code:HF', serviceName: 'HydraFacial', amount: 100 }), redemption({ serviceKey: 'code:HF', serviceName: 'HydraFacial' })];
    expect(computeServiceStats(rows, RANGE, 'All')[0].revenue).toBe(100);
  });

  it('reports package-delivered value instead of discarding it', () => {
    // The regression: revenue summed r.amount alone, which is 0 on a redemption line, so a
    // service delivered through packages looked like it earned nothing.
    const rows = [makeSale({ serviceKey: 'code:HF', serviceName: 'HydraFacial', amount: 100 }), redemption({ serviceKey: 'code:HF', serviceName: 'HydraFacial' })];
    const [stat] = computeServiceStats(rows, RANGE, 'All');
    expect(stat.redeemedRevenue).toBe(100);
    expect(stat.deliveredValue).toBe(200);
  });

  it('ranks by delivered value, so a package-heavy service is not demoted', () => {
    // HydraFacial: 2 cash sales + 8 package sessions = 1000 delivered.
    // IV Drip: 4 cash sales = 600 delivered. Ranking on cash alone would invert these.
    const rows = [
      ...Array.from({ length: 2 }, () => makeSale({ serviceKey: 'code:HF', serviceName: 'HydraFacial', amount: 100 })),
      ...Array.from({ length: 8 }, () => redemption({ serviceKey: 'code:HF', serviceName: 'HydraFacial' })),
      ...Array.from({ length: 4 }, () => makeSale({ serviceKey: 'code:IV', serviceName: 'IV Drip', amount: 150 })),
    ];
    const stats = computeServiceStats(rows, RANGE, 'All');
    expect(stats.map((s) => s.serviceName)).toEqual(['HydraFacial', 'IV Drip']);
    expect(stats[0]).toMatchObject({ revenue: 200, redeemedRevenue: 800, deliveredValue: 1000, count: 10 });
    expect(stats[1]).toMatchObject({ revenue: 600, redeemedRevenue: 0, deliveredValue: 600 });
  });

  it('counts a redemption as a sale of that service', () => {
    const rows = [redemption({ serviceKey: 'code:HF', serviceName: 'HydraFacial', qty: 2 })];
    expect(computeServiceStats(rows, RANGE, 'All')[0]).toMatchObject({ count: 1, qty: 2 });
  });

  it('filters by item type and period', () => {
    const rows = [
      makeSale({ serviceKey: 'code:HF', serviceName: 'HydraFacial', itemType: 'Service', amount: 100 }),
      makeSale({ serviceKey: 'code:P', serviceName: 'Prod', itemType: 'Product', amount: 50 }),
      makeSale({ serviceKey: 'code:HF', serviceName: 'HydraFacial', itemType: 'Service', amount: 999, date: '2026-06-01' }),
    ];
    const stats = computeServiceStats(rows, RANGE, 'Service');
    expect(stats).toHaveLength(1);
    expect(stats[0].deliveredValue).toBe(100);
  });
});

describe('computeDormantServices', () => {
  const asOf = '2026-07-31';

  it('does not treat a service still being delivered via packages as dormant', () => {
    // Only redemption lines, all recent: no new cash, but the service is actively performed.
    const rows = [redemption({ serviceKey: 'code:HF', serviceName: 'HydraFacial', date: '2026-07-30' })];
    expect(computeDormantServices(rows, asOf, 60, 'All')).toHaveLength(0);
  });

  it('flags a service once nothing has been delivered for the threshold', () => {
    const rows = [redemption({ serviceKey: 'code:HF', serviceName: 'HydraFacial', date: '2026-01-01' })];
    const [dormant] = computeDormantServices(rows, asOf, 60, 'All');
    expect(dormant.serviceName).toBe('HydraFacial');
    expect(dormant.daysInactive).toBe(211);
  });

  it('reports lifetime delivered value, including package-delivered', () => {
    const rows = [
      makeSale({ serviceKey: 'code:HF', serviceName: 'HydraFacial', amount: 100, date: '2026-01-01' }),
      redemption({ serviceKey: 'code:HF', serviceName: 'HydraFacial', date: '2026-01-02' }),
    ];
    const [dormant] = computeDormantServices(rows, asOf, 60, 'All');
    expect(dormant).toMatchObject({ revenue: 100, redeemedRevenue: 100, deliveredValue: 200 });
  });
});
