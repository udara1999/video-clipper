import type { Placement } from '../shared/compose';

export interface ComposeTextInput {
  pngs: string | string[];
  start: number;
  end: number;
}

export interface ComposeInput {
  video: Placement;
  backgroundPng: string;
  texts: ComposeTextInput[];
}

const DATA_URL_RE = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
const PNG_MAGIC = 0x89504e47;

export function decodePngDataUrl(dataUrl: string): Buffer | null {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 8 || buf.readUInt32BE(0) !== PNG_MAGIC) return null;
  return buf;
}

export function validateComposeInput(
  body: any,
  clipCount: number,
): { ok: true; value: ComposeInput } | { ok: false; error: string } {
  const c = body?.compose;
  if (!c || typeof c !== 'object') {
    return { ok: false, error: 'compose payload is required for vertical mode' };
  }
  const v = c.video;
  if (
    !v ||
    ![v.x, v.y, v.width].every((n: any) => typeof n === 'number' && Number.isFinite(n)) ||
    v.width <= 0
  ) {
    return { ok: false, error: 'compose.video placement is invalid' };
  }
  if (typeof c.backgroundPng !== 'string' || decodePngDataUrl(c.backgroundPng) === null) {
    return { ok: false, error: 'compose.backgroundPng must be a PNG data URL' };
  }
  if (!Array.isArray(c.texts)) {
    return { ok: false, error: 'compose.texts must be an array' };
  }
  for (const t of c.texts) {
    if (
      typeof t?.start !== 'number' ||
      typeof t?.end !== 'number' ||
      !Number.isFinite(t.start) ||
      !Number.isFinite(t.end)
    ) {
      return { ok: false, error: 'compose text timing is invalid' };
    }
    if (Array.isArray(t.pngs) && t.pngs.length !== clipCount) {
      return { ok: false, error: `per-clip text needs exactly ${clipCount} images` };
    }
    const list: unknown[] = Array.isArray(t.pngs) ? t.pngs : [t.pngs];
    if (list.some((p) => typeof p !== 'string' || decodePngDataUrl(p) === null)) {
      return { ok: false, error: 'compose text image must be a PNG data URL' };
    }
  }
  return { ok: true, value: c as ComposeInput };
}

// Filter graph: input 0 = source clip, input 1 = background PNG, inputs 2..N =
// text PNGs (full-canvas, so they overlay at 0:0 with their enable window).
export function buildComposeFilter(
  video: Placement,
  texts: { start: number; end: number }[],
): string {
  const w = Math.max(2, Math.round(video.width / 2) * 2);
  const x = Math.round(video.x);
  const y = Math.round(video.y);
  const parts = [`[0:v]scale=${w}:-2[v0]`, `[1:v][v0]overlay=${x}:${y}[c0]`];
  texts.forEach((t, i) => {
    parts.push(
      `[c${i}][${i + 2}:v]overlay=0:0:enable='between(t,${t.start},${t.end})'[c${i + 1}]`,
    );
  });
  return parts.join(';');
}
