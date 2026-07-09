export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

export const FONTS = [
  'Inter',
  'Anton',
  'Bebas Neue',
  'Archivo Black',
  'Montserrat',
  'Oswald',
  'Bangers',
  'Roboto Condensed',
] as const;

export interface Placement {
  x: number;
  y: number;
  width: number;
}

export interface TextBackground {
  color: string;
  opacity: number;
}

export interface TextOverlay {
  id: string;
  content: string;
  perClip: Record<number, string>;
  x: number;
  y: number;
  font: string;
  sizePx: number;
  color: string;
  background: TextBackground | null;
  shadow: boolean;
  start: number;
  end: number;
}

export interface ComposeLayout {
  video: Placement;
  background: { path: string; placement: Placement } | null;
  texts: TextOverlay[];
}

export function placementHeight(width: number, aspectW: number, aspectH: number): number {
  return (aspectH / aspectW) * width;
}

export function defaultVideoPlacement(videoW: number, videoH: number): Placement {
  const width = CANVAS_W;
  const height = placementHeight(width, videoW, videoH);
  return { x: 0, y: Math.round((CANVAS_H - height) / 2), width };
}

export function resolveTextContent(
  t: { content: string; perClip: Record<number, string> },
  clipIndex: number,
): string {
  const base = t.perClip[clipIndex] ?? t.content;
  return base.replace(/\{n\}/g, String(clipIndex));
}

export function textVariesPerClip(
  t: { content: string; perClip: Record<number, string> },
  clipCount: number,
): boolean {
  if (clipCount <= 1) return false;
  if (t.content.includes('{n}')) return true;
  return Object.keys(t.perClip).some((k) => {
    const i = Number(k);
    return i >= 1 && i <= clipCount;
  });
}

// Text timing is expressed within the clip; anything outside [0, clipDur]
// is trimmed, and a text with no remaining visible range is dropped.
export function clampTextTiming(
  start: number,
  end: number,
  clipDur: number,
): { start: number; end: number } | null {
  const s = Math.max(0, start);
  const e = Math.min(clipDur, end);
  return s < e ? { start: s, end: e } : null;
}
