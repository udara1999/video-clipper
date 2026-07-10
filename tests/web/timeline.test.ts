import { describe, expect, test } from 'vitest';
import {
  MAX_PPS,
  MIN_LABEL_SPACING_PX,
  clampScroll,
  clampSplitTime,
  clampZoom,
  maxZoom,
  pickTickStep,
  pointAtTime,
  timeAtPoint,
  zoomAroundPoint,
} from '../../web/src/lib/timeline';
import { EPSILON } from '../../shared/segments';

describe('pickTickStep', () => {
  test('picks the smallest step with enough label spacing', () => {
    // 1 px per second → 1s ticks are 1px apart; need >= 70px → 5m step (300s) gives 300px? no: 70/1=70s → 5m
    expect(pickTickStep(1)).toBe(300);
    // 0.01 s per px (very zoomed in): 1s tick = 100px spacing → 1s
    expect(pickTickStep(0.01)).toBe(1);
    // 0.2 s per px: 1s = 5px, 5s = 25px, 15s = 75px → 15s
    expect(pickTickStep(0.2)).toBe(15);
  });
  test('falls back to the largest step when even 1h labels are cramped', () => {
    expect(pickTickStep(600)).toBe(3600);
  });
});

describe('maxZoom / clampZoom', () => {
  test('long video: max zoom reaches MAX_PPS', () => {
    // 3600s video in a 900px container: fit pps = 0.25; maxZoom = 200*3600/900 = 800
    expect(maxZoom(3600, 900)).toBe((MAX_PPS * 3600) / 900);
    expect(clampZoom(10_000, 3600, 900)).toBe(800);
    expect(clampZoom(0.5, 3600, 900)).toBe(1);
  });
  test('short video where fit already exceeds MAX_PPS: max zoom is 1', () => {
    // 2s video in 900px: fit pps = 450 > 200 → maxZoom 1
    expect(maxZoom(2, 900)).toBe(1);
    expect(clampZoom(3, 2, 900)).toBe(1);
  });
});

describe('clampScroll', () => {
  test('clamps into [0, trackWidth - containerWidth]', () => {
    expect(clampScroll(-5, 2, 900)).toBe(0);
    expect(clampScroll(500, 2, 900)).toBe(500);
    expect(clampScroll(5000, 2, 900)).toBe(900);
    expect(clampScroll(100, 1, 900)).toBe(0);
  });
});

describe('timeAtPoint / pointAtTime', () => {
  test('round-trips', () => {
    const duration = 600;
    const zoom = 4;
    const scrollLeft = 1200;
    const containerWidth = 900;
    for (const x of [0, 123, 450, 899]) {
      const t = timeAtPoint(x, scrollLeft, zoom, duration, containerWidth);
      expect(pointAtTime(t, scrollLeft, zoom, duration, containerWidth)).toBeCloseTo(x, 6);
    }
  });
  test('clamps to [0, duration]', () => {
    expect(timeAtPoint(-50, 0, 1, 100, 900)).toBe(0);
    expect(timeAtPoint(2000, 0, 1, 100, 900)).toBe(100);
  });
});

describe('zoomAroundPoint', () => {
  test('keeps the time under the cursor stationary', () => {
    const duration = 3600;
    const containerWidth = 900;
    const state = { zoom: 4, scrollLeft: 800 };
    const cursorX = 333;
    const before = timeAtPoint(cursorX, state.scrollLeft, state.zoom, duration, containerWidth);
    const next = zoomAroundPoint(state, 1.5, cursorX, duration, containerWidth);
    const after = timeAtPoint(cursorX, next.scrollLeft, next.zoom, duration, containerWidth);
    expect(after).toBeCloseTo(before, 6);
    expect(next.zoom).toBeCloseTo(6, 6);
  });
  test('clamps zoom at fit and scroll at the edges', () => {
    const out = zoomAroundPoint({ zoom: 1.2, scrollLeft: 50 }, 0.5, 450, 3600, 900);
    expect(out.zoom).toBe(1);
    expect(out.scrollLeft).toBe(0);
    const max = maxZoom(3600, 900);
    const inMax = zoomAroundPoint({ zoom: max, scrollLeft: 100 }, 2, 450, 3600, 900);
    expect(inMax.zoom).toBe(max);
  });
});

describe('clampSplitTime', () => {
  test('keeps drags inside the open interval', () => {
    expect(clampSplitTime(-3, 100)).toBeGreaterThan(EPSILON);
    expect(clampSplitTime(200, 100)).toBeLessThan(100 - EPSILON);
    expect(clampSplitTime(50, 100)).toBe(50);
  });
});
