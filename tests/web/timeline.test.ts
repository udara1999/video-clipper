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
  visibleTickRange,
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
  test('picks sub-second steps at deep zoom', () => {
    // 0.001 s per px (1000 px/s): 0.1s tick = 100px spacing → 0.1s
    expect(pickTickStep(0.001)).toBe(0.1);
    // 0.004 s per px (250 px/s): 0.1s = 25px, 0.25s = 62.5px, 0.5s = 125px → 0.5s
    expect(pickTickStep(0.004)).toBe(0.5);
  });
  test('falls back to the largest step when even 1h labels are cramped', () => {
    expect(pickTickStep(600)).toBe(3600);
  });
});

describe('maxZoom / clampZoom', () => {
  test('MAX_PPS is 1000 for frame-level placement', () => {
    expect(MAX_PPS).toBe(1000);
  });
  test('long video: max zoom reaches MAX_PPS', () => {
    // 3600s video in a 900px container: fit pps = 0.25; maxZoom = 1000*3600/900 = 4000
    expect(maxZoom(3600, 900)).toBe((MAX_PPS * 3600) / 900);
    expect(clampZoom(10_000, 3600, 900)).toBe(4000);
    expect(clampZoom(0.5, 3600, 900)).toBe(1);
  });
  test('short video where fit already exceeds MAX_PPS: max zoom is 1', () => {
    // 0.5s video in 900px: fit pps = 1800 > 1000 → maxZoom 1
    expect(maxZoom(0.5, 900)).toBe(1);
    expect(clampZoom(3, 0.5, 900)).toBe(1);
  });
});

describe('visibleTickRange', () => {
  test('returns only the tick indices inside the scroll window plus overscan', () => {
    // 3600s at zoom 4000 in 900px: track = 3.6M px, 0.1s step = 100px per tick.
    // Window [100000, 100900] with 200px overscan → times [99.8s, 101.1s].
    const r = visibleTickRange(100_000, 900, 4000, 3600, 0.1, 200);
    // Must cover the window [99.8s, 101.1s] (float rounding may widen by one tick).
    expect(r.first).toBeLessThanOrEqual(Math.floor(99_800 / 100));
    expect(r.last).toBeGreaterThanOrEqual(Math.ceil(101_100 / 100));
    // Well under the full 36k ticks.
    expect(r.last - r.first).toBeLessThan(30);
  });
  test('clamps to the valid tick index range', () => {
    const r = visibleTickRange(0, 900, 1, 60, 5, 200);
    expect(r.first).toBe(0);
    expect(r.last).toBe(12); // 60 / 5
    const end = visibleTickRange(1e9, 900, 1, 60, 5, 200);
    expect(end.last).toBe(12);
    expect(end.first).toBeLessThanOrEqual(end.last);
  });
  test('degenerate inputs yield an empty-ish range', () => {
    const r = visibleTickRange(0, 900, 1, 0, 1, 200);
    expect(r.first).toBe(0);
    expect(r.last).toBe(0);
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
  test('degenerate duration returns the fit state instead of NaN', () => {
    expect(zoomAroundPoint({ zoom: 2, scrollLeft: 100 }, 1.5, 450, 0, 900)).toEqual({
      zoom: 1,
      scrollLeft: 0,
    });
  });
});

describe('clampSplitTime', () => {
  test('keeps drags inside the open interval', () => {
    expect(clampSplitTime(-3, 100)).toBeGreaterThan(EPSILON);
    expect(clampSplitTime(200, 100)).toBeLessThan(100 - EPSILON);
    expect(clampSplitTime(50, 100)).toBe(50);
  });
});
