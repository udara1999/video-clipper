import { describe, expect, test } from 'vitest';
import { formatTimestamp, parseTimestamp } from '../../shared/time';

describe('parseTimestamp', () => {
  test('parses hh:mm:ss', () => {
    expect(parseTimestamp('01:02:03')).toBe(3723);
  });

  test('parses mm:ss', () => {
    expect(parseTimestamp('02:03')).toBe(123);
  });

  test('parses plain seconds', () => {
    expect(parseTimestamp('45')).toBe(45);
    expect(parseTimestamp('90')).toBe(90);
  });

  test('parses fractional seconds', () => {
    expect(parseTimestamp('01:02:03.5')).toBe(3723.5);
    expect(parseTimestamp('3.25')).toBe(3.25);
  });

  test('tolerates surrounding whitespace and single-digit parts', () => {
    expect(parseTimestamp(' 1:2:3 ')).toBe(3723);
  });

  test('rejects malformed input', () => {
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('abc')).toBeNull();
    expect(parseTimestamp('1:2:3:4')).toBeNull();
    expect(parseTimestamp('1:75')).toBeNull(); // seconds >= 60 in colon form
    expect(parseTimestamp('1:75:00')).toBeNull(); // minutes >= 60 in colon form
    expect(parseTimestamp('1:')).toBeNull();
    expect(parseTimestamp('1.5:00')).toBeNull(); // only last part may be fractional
  });
});

describe('formatTimestamp', () => {
  test('formats whole seconds as hh:mm:ss', () => {
    expect(formatTimestamp(3723)).toBe('01:02:03');
    expect(formatTimestamp(0)).toBe('00:00:00');
    expect(formatTimestamp(59)).toBe('00:00:59');
  });

  test('formats fractional seconds with trimmed millis', () => {
    expect(formatTimestamp(3723.5)).toBe('01:02:03.5');
    expect(formatTimestamp(1.25)).toBe('00:00:01.25');
  });

  test('rounds sub-millisecond noise instead of cascading', () => {
    expect(formatTimestamp(59.9999)).toBe('00:01:00');
  });

  test('clamps negatives to zero', () => {
    expect(formatTimestamp(-3)).toBe('00:00:00');
  });

  test('round-trips through parse', () => {
    for (const t of [0, 1, 61, 3723.5, 7200.125]) {
      expect(parseTimestamp(formatTimestamp(t))).toBe(t);
    }
  });
});
