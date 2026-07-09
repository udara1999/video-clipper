import { describe, expect, test } from 'vitest';
import { computeSegments, normalizeSplits } from '../../shared/segments';

describe('normalizeSplits', () => {
  test('sorts ascending', () => {
    expect(normalizeSplits([6, 3], 10)).toEqual([3, 6]);
  });

  test('dedupes near-identical times', () => {
    expect(normalizeSplits([3, 3.005, 3], 10)).toEqual([3]);
  });

  test('drops times outside (0, duration)', () => {
    expect(normalizeSplits([0, -1, 10, 15, 5], 10)).toEqual([5]);
  });

  test('empty input gives empty output', () => {
    expect(normalizeSplits([], 10)).toEqual([]);
  });
});

describe('computeSegments', () => {
  test('no splits yields one full segment', () => {
    expect(computeSegments([], 10)).toEqual([
      { index: 1, start: 0, end: 10, duration: 10 },
    ]);
  });

  test('n splits yield n+1 contiguous segments', () => {
    const segs = computeSegments([3, 6], 10);
    expect(segs).toEqual([
      { index: 1, start: 0, end: 3, duration: 3 },
      { index: 2, start: 3, end: 6, duration: 3 },
      { index: 3, start: 6, end: 10, duration: 4 },
    ]);
  });

  test('normalizes unsorted, duplicated, out-of-range splits first', () => {
    const segs = computeSegments([6, 3, 3, 99], 10);
    expect(segs.map((s) => s.start)).toEqual([0, 3, 6]);
    expect(segs.map((s) => s.end)).toEqual([3, 6, 10]);
  });
});
