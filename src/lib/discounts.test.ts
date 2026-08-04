import { describe, expect, it } from 'vitest';
import { classifyDiscount, computeDiscountBreakdown, computeDiscountDetails, computeDiscountSummary } from './discounts';
import { makeSale } from '../test/fixtures';
import type { DateRange } from './metrics';

const RANGE: DateRange = { start: '2026-07-01', end: '2026-07-31' };

describe('classifyDiscount', () => {
  it('recognizes the named categories', () => {
    expect(classifyDiscount('Manual discount').category).toBe('manual');
    expect(classifyDiscount('Price adjusted').category).toBe('priceAdjusted');
    expect(classifyDiscount('Package Redemption - LHR 3 Sessions').category).toBe('packageRedemption');
  });

  it('extracts the campaign name', () => {
    expect(classifyDiscount('Campaign - Buy 1 Get 1 Free')).toEqual({ category: 'campaign', campaignName: 'Buy 1 Get 1 Free' });
  });

  it('falls back to "other" for an unrecognized or missing name', () => {
    expect(classifyDiscount('Staff comp').category).toBe('other');
    expect(classifyDiscount(null).category).toBe('other');
  });
});

describe('computeDiscountSummary', () => {
  /** One line per category, so any category dropped from the total is immediately visible. */
  const oneOfEach = () => [
    makeSale({ amount: 90, discountName: 'Manual discount', discountAmount: 10 }),
    makeSale({ amount: 80, discountName: 'Campaign - BOGO', discountAmount: 20 }),
    makeSale({ amount: 70, discountName: 'Price adjusted', discountAmount: 30 }),
    makeSale({ amount: 60, discountName: 'Staff comp', discountAmount: 40 }),
    makeSale({ amount: 50, discountName: null, discountAmount: 50 }),
    makeSale({ amount: 0, discountName: 'Package Redemption - LHR', discountAmount: 200, redeemedAmount: 200 }),
  ];

  it('excludes package redemption, and nothing else, from the total', () => {
    // The rule, stated once: package redemption is not a discount - it is the value of an
    // already-paid-for package session being consumed. Every other discount is money given away.
    const s = computeDiscountSummary(oneOfEach(), RANGE);
    expect(s.totalDiscount).toBe(10 + 20 + 30 + 40 + 50);
    expect(s.packageRedemptionDiscount).toBe(200);
  });

  it('counts discounts with an unrecognized or missing name rather than dropping them', () => {
    // The regression: these were counted in discountedLineCount but omitted from totalDiscount,
    // so the KPI read "3 lines, OMR 10" while the breakdown table below it showed OMR 60.
    const s = computeDiscountSummary(oneOfEach(), RANGE);
    expect(s.otherDiscount).toBe(40 + 50);
  });

  it('keeps totalDiscount equal to the sum of its own category fields', () => {
    const s = computeDiscountSummary(oneOfEach(), RANGE);
    expect(s.manualDiscount + s.campaignDiscount + s.priceAdjustedDiscount + s.otherDiscount).toBe(s.totalDiscount);
  });

  it('agrees with the Discounts Breakdown table shown beneath it', () => {
    const rows = oneOfEach();
    const breakdownTotal = computeDiscountBreakdown(rows, RANGE).reduce((sum, b) => sum + b.amount, 0);
    expect(computeDiscountSummary(rows, RANGE).totalDiscount).toBe(breakdownTotal);
  });

  it('counts exactly the lines whose amounts it totals', () => {
    const s = computeDiscountSummary(oneOfEach(), RANGE);
    expect(s.discountedLineCount).toBe(5); // all but the package redemption line
  });

  it('ignores zero-amount discount labels', () => {
    // A "Price adjusted" label with no amount means the adjustment is baked into Price already.
    const s = computeDiscountSummary([makeSale({ amount: 100, discountName: 'Price adjusted', discountAmount: 0 })], RANGE);
    expect(s.totalDiscount).toBe(0);
    expect(s.discountedLineCount).toBe(0);
  });

  it('ignores lines outside the period', () => {
    const rows = [makeSale({ date: '2026-06-30', amount: 90, discountName: 'Manual discount', discountAmount: 10 })];
    expect(computeDiscountSummary(rows, RANGE).totalDiscount).toBe(0);
  });

  it('measures discount % against pre-discount value, and is null with no sales', () => {
    const rows = [makeSale({ amount: 75, discountName: 'Manual discount', discountAmount: 25 })];
    expect(computeDiscountSummary(rows, RANGE).discountPct).toBe(25); // 25 of a 100 sticker price
    expect(computeDiscountSummary([], RANGE).discountPct).toBeNull();
  });
});

describe('computeDiscountDetails', () => {
  it('lists every discounted line except package redemption', () => {
    const rows = [
      makeSale({ amount: 90, discountName: 'Manual discount', discountAmount: 10 }),
      makeSale({ amount: 60, discountName: 'Staff comp', discountAmount: 40 }),
      makeSale({ amount: 0, discountName: 'Package Redemption - LHR', discountAmount: 200, redeemedAmount: 200 }),
    ];
    const details = computeDiscountDetails(rows, RANGE);
    expect(details).toHaveLength(2);
    expect(details.map((d) => d.category).sort()).toEqual(['manual', 'other']);
  });

  it('reconstructs the pre-discount price', () => {
    const rows = [makeSale({ amount: 90, discountName: 'Manual discount', discountAmount: 10 })];
    const [row] = computeDiscountDetails(rows, RANGE);
    expect(row.price).toBe(100);
    expect(row.netPrice).toBe(90);
  });
});

describe('computeDiscountBreakdown', () => {
  it('gives each named campaign its own row but groups the rest by category', () => {
    const rows = [
      makeSale({ amount: 90, discountName: 'Campaign - BOGO', discountAmount: 10 }),
      makeSale({ amount: 90, discountName: 'Campaign - Summer', discountAmount: 20 }),
      makeSale({ amount: 90, discountName: 'Manual discount', discountAmount: 30 }),
      makeSale({ amount: 90, discountName: 'Manual discount', discountAmount: 40 }),
    ];
    const breakdown = computeDiscountBreakdown(rows, RANGE);
    expect(breakdown.map((b) => b.label).sort()).toEqual(['BOGO', 'Manual Discount', 'Summer']);
    expect(breakdown.find((b) => b.label === 'Manual Discount')).toMatchObject({ count: 2, amount: 70 });
  });
});
