import { EPSILON } from '../../../shared/segments';

export const MAX_PPS = 1000; // px per second at maximum zoom (~33px per 30fps frame)
export const MIN_LABEL_SPACING_PX = 70;
export const TICK_STEPS = [0.1, 0.25, 0.5, 1, 5, 15, 30, 60, 300, 900, 3600];

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
  if (duration <= 0 || containerWidth <= 0) {
    return { zoom: 1, scrollLeft: 0 };
  }
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

// Ruler virtualization: at deep zoom a long video would need tens of thousands
// of tick nodes; only the ticks inside the scroll window (plus overscan) are
// rendered. Returns an inclusive index range; tick i sits at time i * tickStep.
export function visibleTickRange(
  scrollLeft: number,
  containerWidth: number,
  zoom: number,
  duration: number,
  tickStep: number,
  overscanPx: number,
): { first: number; last: number } {
  const lastIndex = duration > 0 && tickStep > 0 ? Math.floor(duration / tickStep) : 0;
  if (duration <= 0 || containerWidth <= 0 || tickStep <= 0) {
    return { first: 0, last: lastIndex };
  }
  const pxPerSecond = (containerWidth * zoom) / duration;
  const startTime = (scrollLeft - overscanPx) / pxPerSecond;
  const endTime = (scrollLeft + containerWidth + overscanPx) / pxPerSecond;
  const first = Math.min(Math.max(Math.floor(startTime / tickStep), 0), lastIndex);
  const last = Math.min(Math.max(Math.ceil(endTime / tickStep), first), lastIndex);
  return { first, last };
}
