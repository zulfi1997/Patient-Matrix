import { describe, expect, it } from 'vitest';
import { buildServiceKeyResolver, countUnresolvedServiceLines } from './serviceKeyResolution';
import { computeServiceStats } from './metrics';
import { rowsToRecords } from './excelParser';
import { headerMapFor, makeSale } from '../test/fixtures';
import type { DateRange } from './metrics';

const RANGE: DateRange = { start: '2026-07-01', end: '2026-07-31' };

describe('buildServiceKeyResolver', () => {
  it('leaves a coded line alone', () => {
    const rows = [makeSale({ serviceKey: 'code:HF', serviceName: 'HydraFacial' })];
    expect(buildServiceKeyResolver(rows)(rows[0])).toBe('code:HF');
  });

  it('resolves a code-less line to the code its name carries elsewhere', () => {
    // Services are masters in the source system, so one name has one code - and any export that
    // does carry Item Code tells us which.
    const coded = makeSale({ serviceKey: 'code:HF', serviceName: 'HydraFacial' });
    const codeless = makeSale({ serviceKey: 'type:Service', serviceName: 'HydraFacial' });
    expect(buildServiceKeyResolver([coded, codeless])(codeless)).toBe('code:HF');
  });

  it('matches names ignoring case and spacing', () => {
    const coded = makeSale({ serviceKey: 'code:HF', serviceName: 'HydraFacial  Deluxe' });
    const codeless = makeSale({ serviceKey: 'type:Service', serviceName: '  hydrafacial deluxe ' });
    expect(buildServiceKeyResolver([coded, codeless])(codeless)).toBe('code:HF');
  });

  it('never merges custom packages, whose collapse is deliberate', () => {
    // These carry a patient name and timestamp, so each would otherwise sell exactly once.
    const pkg = makeSale({ itemType: 'Package', serviceKey: 'type:Package', serviceName: 'Derma-Custom Package-Rim-20240324134110' });
    expect(buildServiceKeyResolver([pkg])(pkg)).toBe('type:Package');
  });

  it('falls back to the name when nothing coded shares it', () => {
    const codeless = makeSale({ serviceKey: 'type:Service', serviceName: 'Mystery Treatment' });
    expect(buildServiceKeyResolver([codeless])(codeless)).toBe('name:mystery treatment');
  });

  it('refuses to guess when one name maps to several codes', () => {
    // Picking a code here would silently misattribute revenue to the wrong service.
    const a = makeSale({ serviceKey: 'code:A', serviceName: 'Facial' });
    const b = makeSale({ serviceKey: 'code:B', serviceName: 'Facial' });
    const codeless = makeSale({ serviceKey: 'type:Service', serviceName: 'Facial' });
    expect(buildServiceKeyResolver([a, b, codeless])(codeless)).toBe('name:facial');
  });
});

describe('computeServiceStats with mixed coded and code-less sources', () => {
  const base = { 'Guest Code': 'M1', 'Guest Name': 'A', Qty: 1, 'Invoice status': 'Closed', 'Item Type': 'Service' };

  /** A manual export with no Item Code column at all, and an API sync that has one. */
  function mixedSources() {
    const manual = [
      { ...base, 'Invoice No': 'M1', 'Sale Date': '7/2/2026', 'Item Name': 'HydraFacial', 'Sales (Exc. Tax)': 100 },
      { ...base, 'Invoice No': 'M2', 'Sale Date': '7/3/2026', 'Item Name': 'IV Drip', 'Sales (Exc. Tax)': 150 },
    ];
    const synced = [
      { ...base, 'Invoice No': 'S1', 'Sale Date': '7/20/2026', 'Item Name': 'HydraFacial', 'Item Code': 'HF', 'Sales (Exc. Tax)': 100 },
      { ...base, 'Invoice No': 'S2', 'Sale Date': '7/21/2026', 'Item Name': 'IV Drip', 'Item Code': 'IV', 'Sales (Exc. Tax)': 150 },
    ];
    return [
      ...rowsToRecords(manual, headerMapFor(manual), 'b-manual').records,
      ...rowsToRecords(synced, headerMapFor(synced), 'b-sync').records,
    ];
  }

  it('does not collapse distinct services into one row', () => {
    // The reported bug: with no Item Code column every service became "type:Service", so three
    // services showed as one, labelled by whichever parsed first.
    const stats = computeServiceStats(mixedSources(), RANGE, 'Service');
    expect(stats.map((s) => s.serviceName).sort()).toEqual(['HydraFacial', 'IV Drip']);
  });

  it('merges each service across both sources instead of listing it twice', () => {
    // A name-based key would have produced four rows - one per service per source - which looks
    // plausible and is harder to spot than the collapse it replaced.
    const stats = computeServiceStats(mixedSources(), RANGE, 'Service');
    expect(stats).toHaveLength(2);
    expect(stats.find((s) => s.serviceName === 'HydraFacial')).toMatchObject({ count: 2, deliveredValue: 200, serviceKey: 'code:HF' });
    expect(stats.find((s) => s.serviceName === 'IV Drip')).toMatchObject({ count: 2, deliveredValue: 300, serviceKey: 'code:IV' });
  });

  it('changes nothing when every line already has a code', () => {
    const rows = [
      makeSale({ serviceKey: 'code:HF', serviceName: 'HydraFacial', amount: 100 }),
      makeSale({ serviceKey: 'code:IV', serviceName: 'IV Drip', amount: 150 }),
    ];
    const stats = computeServiceStats(rows, RANGE, 'All');
    expect(stats.map((s) => s.serviceKey).sort()).toEqual(['code:HF', 'code:IV']);
  });
});

describe('countUnresolvedServiceLines', () => {
  it('counts lines that still cannot be told apart', () => {
    const rows = [
      makeSale({ serviceKey: 'code:HF', serviceName: 'HydraFacial' }),
      makeSale({ serviceKey: 'type:Service', serviceName: 'HydraFacial' }), // resolves
      makeSale({ serviceKey: 'type:Service', serviceName: 'Mystery' }), // does not
      makeSale({ itemType: 'Package', serviceKey: 'type:Package', serviceName: 'Custom Pkg' }), // exempt
    ];
    expect(countUnresolvedServiceLines(rows)).toBe(1);
  });

  it('is zero for fully coded data', () => {
    expect(countUnresolvedServiceLines([makeSale({ serviceKey: 'code:HF', serviceName: 'HydraFacial' })])).toBe(0);
  });
});
