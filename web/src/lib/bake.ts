import {
  CANVAS_H,
  CANVAS_W,
  resolveTextContent,
  textVariesPerClip,
  type ComposeLayout,
  type Placement,
  type TextOverlay,
} from '../../../shared/compose';
import { streamUrl } from './api';

// Preview parity: CompositionPanel renders texts with exactly these metrics
// (scaled), so the baked PNG matches what the user saw.
export const TEXT_LINE_HEIGHT = 1.2;
export const TEXT_PAD_RATIO = 0.4; // of font size; box padding + its corner radius = pad/2
export const TEXT_SHADOW_CSS = '0 0 8px rgba(0, 0, 0, 0.8)';

export interface BakedText {
  pngs: string | string[];
  start: number;
  end: number;
}

export interface BakedComposition {
  video: Placement;
  backgroundPng: string;
  texts: BakedText[];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the background image'));
    img.src = src;
  });
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = CANVAS_W;
  c.height = CANVAS_H;
  return [c, c.getContext('2d')!];
}

function bakeText(t: TextOverlay, content: string): string {
  const [c, ctx] = makeCanvas();
  ctx.font = `${t.sizePx}px "${t.font}"`;
  const lines = content.split('\n');
  const lineHeight = t.sizePx * TEXT_LINE_HEIGHT;
  const pad = t.sizePx * TEXT_PAD_RATIO;

  if (t.background) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    ctx.globalAlpha = t.background.opacity;
    ctx.fillStyle = t.background.color;
    ctx.beginPath();
    ctx.roundRect(t.x - pad, t.y - pad, widest + pad * 2, lines.length * lineHeight + pad * 2, pad / 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (t.shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 8;
  }
  ctx.fillStyle = t.color;
  lines.forEach((line, i) => {
    const m = ctx.measureText(line);
    const fontHeight = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
    const halfLeading = (lineHeight - fontHeight) / 2;
    ctx.fillText(line, t.x, t.y + i * lineHeight + halfLeading + m.fontBoundingBoxAscent);
  });
  return c.toDataURL('image/png');
}

export async function bakeComposition(
  layout: ComposeLayout,
  clipCount: number,
): Promise<BakedComposition> {
  const [bg, ctx] = makeCanvas();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  if (layout.background) {
    const img = await loadImage(streamUrl(layout.background.path));
    const p = layout.background.placement;
    const h = (img.naturalHeight / img.naturalWidth) * p.width;
    ctx.drawImage(img, p.x, p.y, p.width, h);
  }

  await Promise.all(layout.texts.map((t) => document.fonts.load(`${t.sizePx}px "${t.font}"`)));

  const texts: BakedText[] = layout.texts.map((t) => ({
    pngs: textVariesPerClip(t, clipCount)
      ? Array.from({ length: clipCount }, (_, i) => bakeText(t, resolveTextContent(t, i + 1)))
      : bakeText(t, resolveTextContent(t, 1)),
    start: t.start,
    end: t.end,
  }));

  return { video: layout.video, backgroundPng: bg.toDataURL('image/png'), texts };
}
