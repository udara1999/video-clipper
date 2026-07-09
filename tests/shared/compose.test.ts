import { describe, expect, test } from 'vitest';
import {
  CANVAS_H,
  CANVAS_W,
  clampTextTiming,
  defaultVideoPlacement,
  placementHeight,
  resolveTextContent,
  textVariesPerClip,
} from '../../shared/compose';

describe('defaultVideoPlacement', () => {
  test('fills the canvas width and centers vertically', () => {
    const p = defaultVideoPlacement(1920, 1080);
    expect(p.width).toBe(CANVAS_W);
    const h = placementHeight(p.width, 1920, 1080);
    expect(h).toBeCloseTo(607.5, 5);
    expect(p.x).toBe(0);
    expect(p.y).toBe(Math.round((CANVAS_H - h) / 2));
  });
});

describe('placementHeight', () => {
  test('derives height from width and aspect', () => {
    expect(placementHeight(1080, 16, 9)).toBeCloseTo(607.5, 5);
    expect(placementHeight(540, 1, 1)).toBe(540);
  });
});

describe('resolveTextContent', () => {
  const t = { content: 'Part {n}', perClip: { 2: 'Finale!' } };
  test('replaces {n} with the clip number', () => {
    expect(resolveTextContent(t, 1)).toBe('Part 1');
    expect(resolveTextContent(t, 3)).toBe('Part 3');
  });
  test('per-clip override wins and also supports {n}', () => {
    expect(resolveTextContent(t, 2)).toBe('Finale!');
    expect(resolveTextContent({ content: 'x', perClip: { 1: 'Clip {n}' } }, 1)).toBe('Clip 1');
  });
});

describe('textVariesPerClip', () => {
  test('static text does not vary', () => {
    expect(textVariesPerClip({ content: 'GG', perClip: {} }, 3)).toBe(false);
  });
  test('{n} token varies (unless there is only one clip)', () => {
    expect(textVariesPerClip({ content: 'Part {n}', perClip: {} }, 3)).toBe(true);
    expect(textVariesPerClip({ content: 'Part {n}', perClip: {} }, 1)).toBe(false);
  });
  test('an override inside the clip range varies; outside does not', () => {
    expect(textVariesPerClip({ content: 'GG', perClip: { 2: 'WOW' } }, 3)).toBe(true);
    expect(textVariesPerClip({ content: 'GG', perClip: { 9: 'WOW' } }, 3)).toBe(false);
  });
});

describe('clampTextTiming', () => {
  test('clamps into [0, clipDur]', () => {
    expect(clampTextTiming(-1, 99, 10)).toEqual({ start: 0, end: 10 });
    expect(clampTextTiming(2, 5, 10)).toEqual({ start: 2, end: 5 });
  });
  test('returns null when nothing remains', () => {
    expect(clampTextTiming(12, 20, 10)).toBeNull();
    expect(clampTextTiming(5, 5, 10)).toBeNull();
    expect(clampTextTiming(8, 2, 10)).toBeNull();
  });
});
