import { describe, expect, it } from 'vitest';
import { computeCorrelationMatrix, correlationStrengthLabel, pearsonCorrelation } from './kpiCatalog';

describe('pearsonCorrelation', () => {
  it('scores a series against itself as a perfect positive correlation', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 10);
  });

  it('scores an exactly inverted series as a perfect negative correlation', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it('is unaffected by scale or offset', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
    expect(pearsonCorrelation([1, 2, 3, 4], [101, 102, 103, 104])).toBeCloseTo(1, 10);
  });

  it('compares unequal-length series over their overlapping points', () => {
    // The regression: means summed each array in full but divided by the shorter length, so the
    // coefficient collapsed toward zero - this returned 0.000002 rather than 1.
    expect(pearsonCorrelation([1, 2, 3], [1, 2, 3, 999999])).toBeCloseTo(1, 10);
    expect(pearsonCorrelation([1, 2, 3, 999999], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('is symmetric in its arguments', () => {
    const a = [3, 1, 4, 1, 5];
    const b = [2, 7, 1, 8, 2];
    expect(pearsonCorrelation(a, b)).toBeCloseTo(pearsonCorrelation(b, a), 10);
  });

  it('returns NaN below three paired points, where a coefficient is meaningless', () => {
    expect(pearsonCorrelation([1, 2], [1, 2])).toBeNaN();
    expect(pearsonCorrelation([1, 2, 3], [])).toBeNaN();
  });

  it('returns 0 rather than dividing by zero when a series is flat', () => {
    expect(pearsonCorrelation([1, 1, 1, 1], [1, 2, 3, 4])).toBe(0);
  });
});

describe('computeCorrelationMatrix', () => {
  it('produces one entry per distinct pair, without self-pairs or duplicates', () => {
    const pts = (values: number[]) => values.map((value, i) => ({ month: `2026-0${i + 1}-01`, value }));
    const matrix = computeCorrelationMatrix([
      { id: 'revenue', points: pts([1, 2, 3, 4]) },
      { id: 'newPatients', points: pts([2, 4, 6, 8]) },
      { id: 'churn', points: pts([4, 3, 2, 1]) },
    ]);
    expect(matrix.map((m) => `${m.aId}~${m.bId}`)).toEqual(['revenue~newPatients', 'revenue~churn', 'newPatients~churn']);
    expect(matrix[0].coefficient).toBeCloseTo(1, 10);
    expect(matrix[1].coefficient).toBeCloseTo(-1, 10);
  });
});

describe('correlationStrengthLabel', () => {
  it('labels by magnitude, so a strong negative reads as strong', () => {
    expect(correlationStrengthLabel(-0.9)).toBe('strongly');
    expect(correlationStrengthLabel(0.5)).toBe('moderately');
    expect(correlationStrengthLabel(0.25)).toBe('weakly');
    expect(correlationStrengthLabel(0.05)).toBe('not meaningfully');
  });
});
