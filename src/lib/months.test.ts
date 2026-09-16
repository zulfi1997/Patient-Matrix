import { describe, expect, it } from 'vitest';
import { WEEKEND_DAYS, workingDaysElapsed, workingDaysInMonth } from './months';

describe('the clinic week', () => {
  it('treats Friday and Saturday as the weekend', () => {
    expect([...WEEKEND_DAYS].sort()).toEqual([5, 6]);
  });
});

describe('workingDaysInMonth', () => {
  it('counts the month rather than assuming a rate per week', () => {
    // September 2026 starts on a Tuesday and holds four full weekends: 30 days less 8.
    expect(workingDaysInMonth('2026-09-01')).toBe(22);
  });

  it('gives two months of the same length different answers when their weekends fall differently', () => {
    // The reason this is counted and not derived: both have 31 days, and estimating from a weekly
    // rate would hand a provider the same daily target in each.
    const august = workingDaysInMonth('2026-08-01');
    const october = workingDaysInMonth('2026-10-01');
    expect(august).not.toBe(october);
  });

  it('handles February, leap year included', () => {
    expect(workingDaysInMonth('2026-02-01')).toBe(20);
    expect(workingDaysInMonth('2028-02-01')).toBe(21);
  });
});

describe('workingDaysElapsed', () => {
  it('skips the weekend days already gone', () => {
    // Through Sunday 6 September: the 4th and 5th were the weekend, so four working days.
    expect(workingDaysElapsed('2026-09-01', '2026-09-06')).toBe(4);
  });

  it('is the whole month once the data runs past its end', () => {
    expect(workingDaysElapsed('2026-09-01', '2026-09-30')).toBe(22);
    expect(workingDaysElapsed('2026-09-01', '2026-12-01')).toBe(22);
  });

  it('is nothing before the month starts', () => {
    expect(workingDaysElapsed('2026-09-01', '2026-08-31')).toBe(0);
  });

  it('does not advance across a weekend', () => {
    // Thursday the 3rd to Saturday the 5th: the clinic opened on none of the days between.
    expect(workingDaysElapsed('2026-09-01', '2026-09-03')).toBe(3);
    expect(workingDaysElapsed('2026-09-01', '2026-09-04')).toBe(3);
    expect(workingDaysElapsed('2026-09-01', '2026-09-05')).toBe(3);
    expect(workingDaysElapsed('2026-09-01', '2026-09-06')).toBe(4);
  });

  it('never exceeds the working days the month has', () => {
    for (const month of ['2026-02-01', '2026-09-01', '2026-10-01', '2028-02-01']) {
      expect(workingDaysElapsed(month, '2030-01-01')).toBe(workingDaysInMonth(month));
    }
  });
});
