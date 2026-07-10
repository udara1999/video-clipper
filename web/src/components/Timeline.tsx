import { useLayoutEffect, useRef, useState } from 'react';
import { computeSegments } from '../../../shared/segments';
import { formatTimestamp } from '../../../shared/time';
import {
  clampSplitTime,
  clampZoom,
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
  const zoomRef = useRef(1);
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
      const next = zoomAroundPoint(
        { zoom: zoomRef.current, scrollLeft: el.scrollLeft },
        factor,
        cursorX,
        duration,
        el.clientWidth,
      );
      el.scrollLeft = next.scrollLeft;
      zoomRef.current = next.zoom;
      setZoom(next.zoom);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [duration]);

  function zoomByButton(factor: number) {
    const el = scrollRef.current;
    if (!el || duration <= 0) return;
    const next = zoomAroundPoint(
      { zoom: zoomRef.current, scrollLeft: el.scrollLeft },
      factor,
      el.clientWidth / 2,
      duration,
      el.clientWidth,
    );
    el.scrollLeft = next.scrollLeft;
    zoomRef.current = next.zoom;
    setZoom(next.zoom);
  }

  function fit() {
    const el = scrollRef.current;
    if (el) el.scrollLeft = 0;
    zoomRef.current = 1;
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
