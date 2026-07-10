# Zoomable Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-width timeline strip with a zoomable, scrollable editor timeline (cursor-anchored wheel zoom, adaptive time ruler, playhead, click-to-seek, draggable split markers with hover-✕ delete).

**Architecture:** Pure zoom/tick/conversion math in a new `web/src/lib/timeline.ts` (unit-tested); `Timeline.tsx` reworked around a scroll container + zoom-scaled inner track; App passes `currentTime` and an `onMoveSplit` callback. Backend untouched.

**Tech Stack:** Existing (React 18, Vite, TS, Vitest).

**Spec:** `docs/superpowers/specs/2026-07-10-zoomable-timeline-design.md`

## Global Constraints

- Zoom 1 = fit (whole video in the container); max zoom = `MAX_PPS = 200` px/second (or fit if the video is so short that fit already exceeds it).
- Wheel zoom is anchored at the cursor: the time under the pointer stays at the same screen x. `+`/`−` buttons zoom ×1.5 / ÷1.5 around the view center; `Fit` resets to 1.
- Ruler tick steps: 1s, 5s, 15s, 30s, 1m, 5m, 15m, 1h — smallest step with pixel spacing ≥ `MIN_LABEL_SPACING_PX = 70`.
- Click on the track seeks to the exact clicked time; click vs marker-drag disambiguated by a 3 px movement threshold; marker drags commit on pointer release (normalize-on-drop) and clamp into `(EPSILON, duration − EPSILON)`.
- Markers delete via a hover ✕ button only (no delete-on-click).
- `S` key, Split-here button, and the editable split list keep working unchanged; both modes use the same component.
- Work on branch `zoomable-timeline` off `main`, repo root (no worktree). TDD for the pure module; commit per task.

---

### Task 1: `web/src/lib/timeline.ts` — pure zoom/tick/conversion math

**Files:**
- Create: `web/src/lib/timeline.ts`
- Test: `tests/web/timeline.test.ts`

**Interfaces:**
- Consumes: `EPSILON` from `shared/segments`.
- Produces (used by Task 2):
  - `MAX_PPS = 200`, `MIN_LABEL_SPACING_PX = 70`, `TICK_STEPS: number[]`
  - `pickTickStep(secondsPerPixel: number): number`
  - `maxZoom(duration: number, containerWidth: number): number` — `max(1, MAX_PPS * duration / containerWidth)`
  - `clampZoom(zoom: number, duration: number, containerWidth: number): number`
  - `clampScroll(scrollLeft: number, zoom: number, containerWidth: number): number` — into `[0, containerWidth * zoom − containerWidth]`
  - `timeAtPoint(x: number, scrollLeft: number, zoom: number, duration: number, containerWidth: number): number` — `x` is container-relative px; result clamped to `[0, duration]`
  - `pointAtTime(t: number, scrollLeft: number, zoom: number, duration: number, containerWidth: number): number`
  - `zoomAroundPoint(state: { zoom: number; scrollLeft: number }, factor: number, cursorX: number, duration: number, containerWidth: number): { zoom: number; scrollLeft: number }`
  - `clampSplitTime(t: number, duration: number): number` — into `(EPSILON, duration − EPSILON)` via `min/max` with a small inset of `2 * EPSILON` so the result survives `normalizeSplits`.

- [ ] **Step 0: Create the feature branch**

```bash
cd /Users/udara/Projects/video-clipper
git checkout -b zoomable-timeline main
```

- [ ] **Step 1: Write the failing tests**

Create `tests/web/timeline.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/web/timeline.test.ts`
Expected: FAIL — cannot resolve `../../web/src/lib/timeline`.

- [ ] **Step 3: Create `web/src/lib/timeline.ts`**

```ts
import { EPSILON } from '../../../shared/segments';

export const MAX_PPS = 200; // px per second at maximum zoom
export const MIN_LABEL_SPACING_PX = 70;
export const TICK_STEPS = [1, 5, 15, 30, 60, 300, 900, 3600];

export function pickTickStep(secondsPerPixel: number): number {
  for (const step of TICK_STEPS) {
    if (step / secondsPerPixel >= MIN_LABEL_SPACING_PX) return step;
  }
  return TICK_STEPS[TICK_STEPS.length - 1];
}

export function maxZoom(duration: number, containerWidth: number): number {
  if (duration <= 0 || containerWidth <= 0) return 1;
  return Math.max(1, (MAX_PPS * duration) / containerWidth);
}

export function clampZoom(zoom: number, duration: number, containerWidth: number): number {
  return Math.min(Math.max(zoom, 1), maxZoom(duration, containerWidth));
}

export function clampScroll(scrollLeft: number, zoom: number, containerWidth: number): number {
  const maxScroll = Math.max(0, containerWidth * zoom - containerWidth);
  return Math.min(Math.max(scrollLeft, 0), maxScroll);
}

export function timeAtPoint(
  x: number,
  scrollLeft: number,
  zoom: number,
  duration: number,
  containerWidth: number,
): number {
  if (duration <= 0 || containerWidth <= 0) return 0;
  const trackWidth = containerWidth * zoom;
  const t = ((scrollLeft + x) / trackWidth) * duration;
  return Math.min(Math.max(t, 0), duration);
}

export function pointAtTime(
  t: number,
  scrollLeft: number,
  zoom: number,
  duration: number,
  containerWidth: number,
): number {
  if (duration <= 0 || containerWidth <= 0) return 0;
  const trackWidth = containerWidth * zoom;
  return (t / duration) * trackWidth - scrollLeft;
}

// Cursor-anchored zoom: the time under cursorX keeps its screen position.
export function zoomAroundPoint(
  state: { zoom: number; scrollLeft: number },
  factor: number,
  cursorX: number,
  duration: number,
  containerWidth: number,
): { zoom: number; scrollLeft: number } {
  const zoom = clampZoom(state.zoom * factor, duration, containerWidth);
  const anchor = timeAtPoint(cursorX, state.scrollLeft, state.zoom, duration, containerWidth);
  const trackWidth = containerWidth * zoom;
  const scrollLeft = clampScroll((anchor / duration) * trackWidth - cursorX, zoom, containerWidth);
  return { zoom, scrollLeft };
}

// Inset by 2*EPSILON so a committed drag survives normalizeSplits' boundary filter.
export function clampSplitTime(t: number, duration: number): number {
  const inset = 2 * EPSILON;
  return Math.min(Math.max(t, inset), duration - inset);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/web/timeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + commit**

Run: `npm test`

```bash
git add web/src/lib/timeline.ts tests/web/timeline.test.ts
git commit -m "feat: pure timeline zoom, tick, and conversion math"
```

---

### Task 2: Rework `Timeline.tsx` + wire App + styles

**Files:**
- Modify: `web/src/components/Timeline.tsx` (full replacement), `web/src/App.tsx` (props), `web/src/styles.css` (replace timeline block, append new styles)

**Interfaces:**
- Consumes: everything from Task 1; `computeSegments`/`normalizeSplits` from `shared/segments`; `formatTimestamp` from `shared/time`.
- Produces: `Timeline({ duration, splits, currentTime, onSeek, onMoveSplit, onRemoveSplit })` where `onMoveSplit: (oldT: number, newT: number) => void`.

- [ ] **Step 1: Replace `web/src/components/Timeline.tsx`**

```tsx
import { useLayoutEffect, useRef, useState } from 'react';
import { computeSegments } from '../../../shared/segments';
import { formatTimestamp } from '../../../shared/time';
import {
  clampScroll,
  clampSplitTime,
  clampZoom,
  maxZoom,
  pickTickStep,
  timeAtPoint,
  zoomAroundPoint,
} from '../lib/timeline';

const DRAG_THRESHOLD_PX = 3;

interface TimelineProps {
  duration: number;
  splits: number[];
  currentTime: number;
  onSeek: (t: number) => void;
  onMoveSplit: (oldT: number, newT: number) => void;
  onRemoveSplit: (t: number) => void;
}

export function Timeline({
  duration,
  splits,
  currentTime,
  onSeek,
  onMoveSplit,
  onRemoveSplit,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  // While dragging: which split is held and where it currently sits.
  const [drag, setDrag] = useState<{ origin: number; current: number } | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel zoom must preventDefault, which needs a non-passive listener.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || duration <= 0) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return; // horizontal scroll pans natively
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const factor = e.deltaY < 0 ? 1.25 : 0.8;
      setZoom((z) => {
        const next = zoomAroundPoint(
          { zoom: z, scrollLeft: el.scrollLeft },
          factor,
          cursorX,
          duration,
          el.clientWidth,
        );
        el.scrollLeft = next.scrollLeft;
        return next.zoom;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [duration]);

  function zoomByButton(factor: number) {
    const el = scrollRef.current;
    if (!el || duration <= 0) return;
    const next = zoomAroundPoint(
      { zoom, scrollLeft: el.scrollLeft },
      factor,
      el.clientWidth / 2,
      duration,
      el.clientWidth,
    );
    el.scrollLeft = next.scrollLeft;
    setZoom(next.zoom);
  }

  function fit() {
    const el = scrollRef.current;
    if (el) el.scrollLeft = 0;
    setZoom(1);
  }

  function eventTime(e: React.PointerEvent): number {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return timeAtPoint(e.clientX - rect.left, el.scrollLeft, zoom, duration, el.clientWidth);
  }

  function onTrackPointerDown(e: React.PointerEvent) {
    if (duration <= 0 || (e.target as HTMLElement).closest('.split-marker-hit')) return;
    onSeek(eventTime(e));
  }

  function onMarkerPointerDown(e: React.PointerEvent, t: number) {
    e.preventDefault();
    e.stopPropagation();
    // Capture on the scroll container, not the marker: the marker element is
    // re-rendered as it moves, and a remounted element loses its capture.
    const target = scrollRef.current as Element;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const el = scrollRef.current!;
      const rect = el.getBoundingClientRect();
      const time = clampSplitTime(
        timeAtPoint(ev.clientX - rect.left, el.scrollLeft, zoom, duration, el.clientWidth),
        duration,
      );
      setDrag({ origin: t, current: time });
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {
        // element may already be gone
      }
      setDrag(null);
      if (moved) {
        const el = scrollRef.current!;
        const rect = el.getBoundingClientRect();
        const time = clampSplitTime(
          timeAtPoint(ev.clientX - rect.left, el.scrollLeft, zoom, duration, el.clientWidth),
          duration,
        );
        onMoveSplit(t, time);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  // Splits as rendered: the dragged split follows the pointer locally.
  const liveSplits = drag
    ? [...splits.filter((x) => x !== drag.origin), drag.current].sort((a, b) => a - b)
    : splits;
  const segments = computeSegments(liveSplits, duration);

  const effectiveWidth = containerWidth || 1;
  const trackWidth = effectiveWidth * clampZoom(zoom, duration, effectiveWidth);
  const secondsPerPixel = duration > 0 ? duration / trackWidth : 1;
  const tickStep = pickTickStep(secondsPerPixel);
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += tickStep) ticks.push(t);

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);

  return (
    <div className="timeline-wrap">
      <div className="timeline-controls">
        <button onClick={() => zoomByButton(1.5)} title="Zoom in">
          +
        </button>
        <button onClick={() => zoomByButton(1 / 1.5)} title="Zoom out">
          −
        </button>
        <button onClick={fit} title="Fit whole video">
          Fit
        </button>
        <span className="muted">scroll on the timeline to zoom</span>
      </div>
      <div ref={scrollRef} className="timeline-scroll">
        <div className="timeline-track" style={{ width: trackWidth }} onPointerDown={onTrackPointerDown}>
          <div className="ruler">
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: `${pct(t)}%` }}>
                <span>{formatTimestamp(t)}</span>
              </div>
            ))}
          </div>
          <div className="timeline">
            {segments.map((seg) => (
              <div
                key={`${seg.index}-${seg.start}`}
                className="segment"
                style={{ width: `${pct(seg.duration)}%` }}
                title={`Clip ${seg.index}: ${formatTimestamp(seg.start)} → ${formatTimestamp(seg.end)}`}
              >
                <span className="segment-label">Clip {seg.index}</span>
                <span className="segment-duration">{formatTimestamp(seg.duration)}</span>
              </div>
            ))}
            {liveSplits.map((t) => (
              <div
                key={drag && drag.current === t ? 'dragging' : t}
                className={`split-marker-hit ${drag && drag.current === t ? 'dragging' : ''}`}
                style={{ left: `${pct(t)}%` }}
                onPointerDown={(e) => onMarkerPointerDown(e, drag && drag.current === t ? drag.origin : t)}
                title={`Split at ${formatTimestamp(t)} — drag to move`}
              >
                <div className="split-marker" />
                <button
                  className="split-delete"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveSplit(drag && drag.current === t ? drag.origin : t);
                  }}
                  title={`Delete split at ${formatTimestamp(t)}`}
                >
                  ✕
                </button>
              </div>
            ))}
            {duration > 0 && <div className="playhead" style={{ left: `${pct(currentTime)}%` }} />}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the new props in `web/src/App.tsx`**

Replace the `<Timeline …/>` usage with:

```tsx
              <Timeline
                duration={video.durationSec}
                splits={splits}
                currentTime={currentTime}
                onSeek={seek}
                onMoveSplit={(oldT, newT) =>
                  setNormalizedSplits([...splits.filter((x) => x !== oldT), newT])
                }
                onRemoveSplit={(t) => setNormalizedSplits(splits.filter((x) => x !== t))}
              />
```

- [ ] **Step 3: Restyle in `web/src/styles.css`**

Replace the existing `.timeline` / `.segment` / `.split-marker` block (from `.timeline {` through the `.split-marker:hover {…}` rule) with:

```css
.timeline-wrap {
  margin: 0.6rem 0;
}

.timeline-controls {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.35rem;
}

.timeline-controls button {
  padding: 0.15rem 0.6rem;
}

.timeline-controls .muted {
  font-size: 0.75rem;
  margin-left: 0.4rem;
}

.timeline-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 2px);
  background: var(--surface);
  overscroll-behavior-x: contain;
}

.timeline-track {
  position: relative;
  min-width: 100%;
}

.ruler {
  position: relative;
  height: 18px;
  border-bottom: 1px solid var(--border);
  overflow: hidden;
}

.ruler .tick {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px solid var(--border);
  padding-left: 3px;
  font-size: 0.65rem;
  color: var(--muted);
  white-space: nowrap;
  pointer-events: none;
}

.timeline {
  position: relative;
  display: flex;
  height: 46px;
  overflow: hidden;
}

.segment {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-width: 0;
  background: rgba(108, 123, 255, 0.16);
  font-size: 0.72rem;
  white-space: nowrap;
  overflow: hidden;
  pointer-events: none;
}

.segment:nth-child(even) {
  background: rgba(108, 123, 255, 0.28);
}

.segment-duration {
  color: var(--muted);
}

.split-marker-hit {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 14px;
  margin-left: -7px;
  cursor: ew-resize;
  touch-action: none;
}

.split-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 5px;
  width: 4px;
  background: var(--danger);
  pointer-events: none;
}

.split-marker-hit:hover .split-marker,
.split-marker-hit.dragging .split-marker {
  background: #ff8073;
}

.split-delete {
  position: absolute;
  top: 1px;
  left: 50%;
  transform: translateX(-50%);
  display: none;
  padding: 0 0.25rem;
  font-size: 0.65rem;
  line-height: 1.2;
  background: var(--bg);
  border: 1px solid var(--border);
}

.split-marker-hit:hover .split-delete {
  display: block;
}

.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--text);
  opacity: 0.85;
  pointer-events: none;
}
```

- [ ] **Step 4: Typecheck, build, full suite**

Run: `npm run typecheck && npm run build && npm test`
Expected: all green (102 existing + Task 1's new tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Timeline.tsx web/src/App.tsx web/src/styles.css
git commit -m "feat: zoomable timeline with ruler, playhead, and draggable split markers"
```

---

### Task 3: README note + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the "Mark splits" usage bullet in `README.md`**

Replace item 2's text ("**Mark splits** — press **Split here** …") with:

```markdown
2. **Mark splits** — press **Split here** (or the `S` key) while
   watching/scrubbing, or type `hh:mm:ss` timestamps. Scroll on the timeline
   to zoom in (up to 200 px/second) for frame-tight placement on long
   videos — drag a split marker to fine-tune it, hover it for ✕ to delete,
   and click anywhere on the strip to seek there.
```

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm run build && npm test`
Expected: all green.

- [ ] **Step 3: Manual check (deferred to the user)**

With a long real video: wheel-zoom until 1 s ticks appear, drag a marker precisely, ✕-delete one, click-seek, confirm S-key/list still work, check both modes.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe the zoomable timeline"
```
