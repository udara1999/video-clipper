import { expect, test } from 'vitest';
import { computeScheduleTimes } from '../../shared/scheduler';

const T0 = Date.UTC(2026, 6, 11, 9, 0, 0);

test('spaces posts by the gap in minutes', () => {
  expect(computeScheduleTimes(T0, 90, 3)).toEqual([
    T0,
    T0 + 90 * 60_000,
    T0 + 180 * 60_000,
  ]);
});

test('zero gap schedules everything at the start time', () => {
  expect(computeScheduleTimes(T0, 0, 3)).toEqual([T0, T0, T0]);
});

test('negative gaps are treated as zero', () => {
  expect(computeScheduleTimes(T0, -15, 2)).toEqual([T0, T0]);
});

test('zero count returns an empty list', () => {
  expect(computeScheduleTimes(T0, 60, 0)).toEqual([]);
});
