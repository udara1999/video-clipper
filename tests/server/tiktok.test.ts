import { expect, test } from 'vitest';
import { planChunks } from '../../server/scheduler/tiktok';

const MB = 1024 * 1024;

test('videos at or under 64MB upload as a single chunk', () => {
  const plan = planChunks(3 * MB);
  expect(plan.totalChunkCount).toBe(1);
  expect(plan.chunkSize).toBe(3 * MB);
  expect(plan.ranges).toEqual([{ start: 0, end: 3 * MB }]);

  expect(planChunks(64 * MB).totalChunkCount).toBe(1);
});

test('larger videos use 10MB chunks with the remainder merged into the last', () => {
  const size = 95 * MB; // 9 full chunks + 5MB remainder
  const plan = planChunks(size);
  expect(plan.chunkSize).toBe(10 * MB);
  expect(plan.totalChunkCount).toBe(9);
  expect(plan.ranges[0]).toEqual({ start: 0, end: 10 * MB });
  expect(plan.ranges.at(-1)).toEqual({ start: 80 * MB, end: size });
});

test('ranges cover the file exactly with no gaps or overlap', () => {
  const size = 123_456_789;
  const plan = planChunks(size);
  let cursor = 0;
  for (const { start, end } of plan.ranges) {
    expect(start).toBe(cursor);
    expect(end).toBeGreaterThan(start);
    cursor = end;
  }
  expect(cursor).toBe(size);
});

test('empty files are rejected', () => {
  expect(() => planChunks(0)).toThrow(/empty/);
});
