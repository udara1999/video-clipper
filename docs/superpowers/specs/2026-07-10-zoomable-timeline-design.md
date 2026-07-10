# Zoomable Timeline — Design

**Date:** 2026-07-10
**Status:** Approved
**Builds on:** `2026-07-09-video-clipper-design.md`, `2026-07-09-vertical-compose-design.md`

## Purpose

On long recordings the timeline strip maps the whole duration to ~900 px (a 1-hour video ≈ 4 s per pixel), making precise split placement impossible. Rework the timeline into a zoomable, scrollable editor strip (CapCut/TikTok style) with a time ruler, playhead, exact-position seeking, and draggable split markers.

## Requirements

- **Zoom:** the strip lives in a horizontally scrollable container; the inner track width = container width × zoom. Zoom 1 = fit (whole video); max zoom caps at 200 px/second (or fit, whichever is larger). Wheel/trackpad scroll over the timeline zooms **around the time under the cursor** (that point stays fixed on screen). `+` / `−` buttons (×1.5 steps) zoom around the view center; `Fit` resets to zoom 1. Horizontal pan via native horizontal scroll/trackpad and scrollbar.
- **Time ruler:** slim ruler above the segment strip; tick interval adapts to zoom via `pickTickStep(secondsPerPixel)` choosing from 1s, 5s, 15s, 30s, 1m, 5m, 15m, 1h so labels are ≥ ~70 px apart. Labels use `formatTimestamp` (mm:ss / hh:mm:ss).
- **Playhead:** a thin vertical line at `currentTime` across ruler + strip.
- **Click = seek:** clicking anywhere on the track seeks the player to that exact time (replaces the old click-segment-seeks-to-its-start behavior). Click vs drag disambiguated by a 3 px movement threshold.
- **Markers:** split markers are draggable (pointer capture + pointercancel, same pattern as the stage). During a drag the marker and segment boundaries follow the pointer locally; the new time **commits on pointer release** (then normalizes — crossing another split merges only on drop). Dragging clamps to (0, duration) exclusive with the shared EPSILON. Hovering a marker shows a small ✕ button that deletes it; markers are no longer delete-on-click.
- Existing split entry points unchanged: `S` key, Split-here button, editable timestamp list.
- Works identically in both modes (lossless and vertical) — same component instance.
- Segments still render as labeled blocks (`Clip N` + duration) inside the track.

## Architecture

- **`web/src/lib/timeline.ts`** (new, pure — unit-tested):
  - `MAX_PPS = 200`, `MIN_LABEL_SPACING_PX = 70`, `TICK_STEPS = [1, 5, 15, 30, 60, 300, 900, 3600]`
  - `pickTickStep(secondsPerPixel: number): number` — smallest step whose pixel spacing ≥ MIN_LABEL_SPACING_PX (falls back to the largest step).
  - `clampZoom(zoom: number, duration: number, containerWidth: number): number` — into [1, maxZoom] where maxZoom = MAX_PPS × duration / containerWidth (min 1).
  - `zoomAroundPoint(state: { zoom, scrollLeft }, factor, cursorX, duration, containerWidth): { zoom, scrollLeft }` — keeps the time under `cursorX` (container-relative px) stationary; clamps zoom and scrollLeft (≥ 0, ≤ trackWidth − containerWidth).
  - `timeAtPoint(x, scrollLeft, zoom, duration, containerWidth): number` and `pointAtTime(t, …): number` — px↔seconds conversions.
  - `clampSplitTime(t: number, duration: number): number` — clamp into (EPSILON, duration − EPSILON).
- **`web/src/components/Timeline.tsx`** (rework): scroll container (ref) + track div; local `zoom`/hover state; ResizeObserver for container width; wheel handler (`preventDefault`, non-passive listener) → `zoomAroundPoint`; pointer handlers for click-to-seek vs marker drag (3 px threshold, pointer capture); ruler ticks + labels; playhead line; ✕ delete buttons on marker hover.
  - Props: `{ duration, splits, currentTime, onSeek: (t) => void, onMoveSplit: (oldT, newT) => void, onRemoveSplit: (t) => void }`.
- **`web/src/App.tsx`:** pass `currentTime` and `onMoveSplit={(oldT, newT) => setNormalizedSplits([...splits.filter(x => x !== oldT), newT])}`; `onSeek` unchanged.
- **`web/src/styles.css`:** ruler, playhead, track, marker-hover ✕, zoom-control styles.
- Backend untouched.

## Error handling / edge cases

- Wheel zoom at zoom 1 with zoom-out gesture: no-op (already fit).
- Container narrower than 100 px or duration 0: component renders the fit view and ignores zoom input.
- Marker dragged onto another split: merges on release via existing `normalizeSplits` (same as typing a duplicate time).
- Scroll position re-clamped when zoom or container size shrinks the track.

## Testing

- Unit (vitest, node): `pickTickStep` across zoom levels; `clampZoom` bounds incl. short videos where fit > MAX_PPS; `zoomAroundPoint` keeps the cursor time fixed (property: timeAtPoint before == after) and clamps at edges; `timeAtPoint`/`pointAtTime` round-trip; `clampSplitTime` bounds.
- Full suite must not regress; typecheck + build.
- Manual: long video — wheel-zoom to 1 s ticks, drag a marker precisely, click-seek, ✕ delete, both modes.

## Out of scope (YAGNI)

- Filmstrip thumbnails, auto-follow playhead during playback, snapping to keyframes/ticks, minimap, keyboard nudging of markers.
