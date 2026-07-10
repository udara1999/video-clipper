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
