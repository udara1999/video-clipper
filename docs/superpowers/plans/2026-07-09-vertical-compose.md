# Vertical 9:16 Compose Mode + Dark Editor UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WYSIWYG 9:16 vertical composition mode (video placement, background image, timed formatted text overlays, re-encoded export) to video-clipper, and restyle the whole app as a dark video-editor UI.

**Architecture:** The composition panel is plain DOM on a scaled 1080×1920 stage. On export the browser bakes the background and each text overlay to PNGs (same rendering engine as the preview → WYSIWYG), uploads them as data URLs, and the server runs one ffmpeg re-encode per clip with a simple overlay filter graph. The existing lossless export path is untouched; both paths share one job store.

**Tech Stack:** Existing stack (Express 5, ffmpeg-static, React 18, Vite, TS, Vitest) + `@fontsource/*` packages for bundled fonts.

**Spec:** `docs/superpowers/specs/2026-07-09-vertical-compose-design.md`
**Mockup:** `docs/superpowers/Screenshot 2026-07-09 at 19.04.28.png`

## Global Constraints

- Canvas is fixed **1080×1920** (`CANVAS_W`/`CANVAS_H` in `shared/compose.ts`); other ratios/resolutions are out of scope.
- Two export modes: `'lossless'` (existing behavior — must not change) and `'vertical'`. `POST /api/export` `mode` defaults to `'lossless'`.
- Vertical output: always `.mp4`, H.264 `-crf 18 -preset veryfast -pix_fmt yuv420p`, audio `-c:a aac -b:a 192k`, `-movflags +faststart`, source fps (no `-r`); one ffmpeg run per clip, sequential, `-ss <start> -t <dur>` before `-i` (frame-accurate, no keyframe snapping, no mergedCuts).
- WYSIWYG: background and texts are baked to PNGs **in the browser**; ffmpeg only overlays PNGs — it never needs font files. Text PNGs are full-canvas (1080×1920, transparent) so ffmpeg overlays at `0:0`.
- Text content supports the `{n}` token (→ clip number) and per-clip overrides; text timing is `start`/`end` seconds **within the clip**, clamped server-side (dropped if empty after clamping).
- Bundled fonts (exact family names): Inter, Anton, Bebas Neue, Archivo Black, Montserrat, Oswald, Bangers, Roboto Condensed.
- `express.json` limit: `'100mb'`.
- Conflict/overwrite/stale-clip handling identical to lossless mode (with `.mp4` extension).
- Dark editor theme: whole app, CSS-variable tokens, left stage column + right properties column.
- Server still binds 127.0.0.1 only. TDD for all pure logic and server endpoints; commit per task.
- Work on a feature branch `vertical-compose` off `main`, in the repo root (no worktree — user preference).

---

### Task 1: `shared/compose.ts` — types, constants, pure layout/text logic

**Files:**
- Create: `shared/compose.ts`
- Test: `tests/shared/compose.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by server + web):
  - `CANVAS_W = 1080`, `CANVAS_H = 1920`, `FONTS: readonly string[]`
  - `interface Placement { x: number; y: number; width: number }`
  - `interface TextBackground { color: string; opacity: number }`
  - `interface TextOverlay { id: string; content: string; perClip: Record<number, string>; x: number; y: number; font: string; sizePx: number; color: string; background: TextBackground | null; shadow: boolean; start: number; end: number }`
  - `interface ComposeLayout { video: Placement; background: { path: string; placement: Placement } | null; texts: TextOverlay[] }`
  - `defaultVideoPlacement(videoW: number, videoH: number): Placement` — full canvas width, vertically centered.
  - `placementHeight(width: number, aspectW: number, aspectH: number): number`
  - `resolveTextContent(t: { content: string; perClip: Record<number, string> }, clipIndex: number): string` — override wins, then `{n}` replaced.
  - `textVariesPerClip(t: { content: string; perClip: Record<number, string> }, clipCount: number): boolean`
  - `clampTextTiming(start: number, end: number, clipDur: number): { start: number; end: number } | null`

- [ ] **Step 0: Create the feature branch**

```bash
cd /Users/udara/Projects/video-clipper
git checkout -b vertical-compose main
```

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/compose.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  CANVAS_H,
  CANVAS_W,
  clampTextTiming,
  defaultVideoPlacement,
  placementHeight,
  resolveTextContent,
  textVariesPerClip,
} from '../../shared/compose';

describe('defaultVideoPlacement', () => {
  test('fills the canvas width and centers vertically', () => {
    const p = defaultVideoPlacement(1920, 1080);
    expect(p.width).toBe(CANVAS_W);
    const h = placementHeight(p.width, 1920, 1080);
    expect(h).toBeCloseTo(607.5, 5);
    expect(p.x).toBe(0);
    expect(p.y).toBe(Math.round((CANVAS_H - h) / 2));
  });
});

describe('placementHeight', () => {
  test('derives height from width and aspect', () => {
    expect(placementHeight(1080, 16, 9)).toBeCloseTo(607.5, 5);
    expect(placementHeight(540, 1, 1)).toBe(540);
  });
});

describe('resolveTextContent', () => {
  const t = { content: 'Part {n}', perClip: { 2: 'Finale!' } };
  test('replaces {n} with the clip number', () => {
    expect(resolveTextContent(t, 1)).toBe('Part 1');
    expect(resolveTextContent(t, 3)).toBe('Part 3');
  });
  test('per-clip override wins and also supports {n}', () => {
    expect(resolveTextContent(t, 2)).toBe('Finale!');
    expect(resolveTextContent({ content: 'x', perClip: { 1: 'Clip {n}' } }, 1)).toBe('Clip 1');
  });
});

describe('textVariesPerClip', () => {
  test('static text does not vary', () => {
    expect(textVariesPerClip({ content: 'GG', perClip: {} }, 3)).toBe(false);
  });
  test('{n} token varies (unless there is only one clip)', () => {
    expect(textVariesPerClip({ content: 'Part {n}', perClip: {} }, 3)).toBe(true);
    expect(textVariesPerClip({ content: 'Part {n}', perClip: {} }, 1)).toBe(false);
  });
  test('an override inside the clip range varies; outside does not', () => {
    expect(textVariesPerClip({ content: 'GG', perClip: { 2: 'WOW' } }, 3)).toBe(true);
    expect(textVariesPerClip({ content: 'GG', perClip: { 9: 'WOW' } }, 3)).toBe(false);
  });
});

describe('clampTextTiming', () => {
  test('clamps into [0, clipDur]', () => {
    expect(clampTextTiming(-1, 99, 10)).toEqual({ start: 0, end: 10 });
    expect(clampTextTiming(2, 5, 10)).toEqual({ start: 2, end: 5 });
  });
  test('returns null when nothing remains', () => {
    expect(clampTextTiming(12, 20, 10)).toBeNull();
    expect(clampTextTiming(5, 5, 10)).toBeNull();
    expect(clampTextTiming(8, 2, 10)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/compose.test.ts`
Expected: FAIL — cannot resolve `../../shared/compose`.

- [ ] **Step 3: Create `shared/compose.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/compose.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + commit**

Run: `npm test` (expect 62 + new all passing)

```bash
git add shared/compose.ts tests/shared/compose.test.ts
git commit -m "feat: compose layout types and pure text/placement logic"
```

---

### Task 2: `server/jobs.ts` + `server/compose.ts` pure parts — job store extraction, payload validation, filter builder

**Files:**
- Create: `server/jobs.ts`, `server/compose.ts`
- Modify: `server/export.ts` (use the shared job store; no behavior change)
- Test: `tests/server/compose-unit.test.ts`

**Interfaces:**
- Consumes: `Placement`, `clampTextTiming` from `shared/compose` (Task 1).
- Produces:
  - `server/jobs.ts`: `interface ClipResult { fileName: string; start: number; end: number; duration: number }`, `interface ExportJob { id: string; status: 'running' | 'done' | 'error'; percent: number; error?: string; stderrTail?: string; results?: ClipResult[]; mergedCuts?: number; clipIndex?: number; clipCount?: number }`, `createJob(): ExportJob`, `getJob(id: string): ExportJob | undefined`.
  - `server/compose.ts` (pure parts): `interface ComposeTextInput { pngs: string | string[]; start: number; end: number }`, `interface ComposeInput { video: Placement; backgroundPng: string; texts: ComposeTextInput[] }`, `decodePngDataUrl(dataUrl: string): Buffer | null`, `validateComposeInput(body: any, clipCount: number): { ok: true; value: ComposeInput } | { ok: false; error: string }`, `buildComposeFilter(video: Placement, texts: { start: number; end: number }[]): string`.
  - `server/export.ts` keeps re-exporting `getJob`, `ExportJob`, `ClipResult` so `server/app.ts` and existing tests are unaffected.

- [ ] **Step 1: Write the failing tests**

Create `tests/server/compose-unit.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  buildComposeFilter,
  decodePngDataUrl,
  validateComposeInput,
} from '../../server/compose';

// 1x1 transparent PNG
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('decodePngDataUrl', () => {
  test('decodes a valid PNG data URL', () => {
    const buf = decodePngDataUrl(PNG_DATA_URL);
    expect(buf).not.toBeNull();
    expect(buf!.readUInt32BE(0)).toBe(0x89504e47);
  });
  test('rejects non-PNG payloads and garbage', () => {
    expect(decodePngDataUrl('data:image/jpeg;base64,/9j/4AAQ')).toBeNull();
    expect(decodePngDataUrl('data:image/png;base64,aGVsbG8=')).toBeNull(); // not PNG magic
    expect(decodePngDataUrl('nonsense')).toBeNull();
  });
});

describe('validateComposeInput', () => {
  const good = {
    compose: {
      video: { x: 0, y: 656, width: 1080 },
      backgroundPng: PNG_DATA_URL,
      texts: [{ pngs: PNG_DATA_URL, start: 0, end: 3 }],
    },
  };
  test('accepts a valid payload', () => {
    const r = validateComposeInput(good, 2);
    expect(r.ok).toBe(true);
  });
  test('rejects missing compose, bad placement, bad png, bad texts', () => {
    expect(validateComposeInput({}, 2).ok).toBe(false);
    expect(
      validateComposeInput(
        { compose: { ...good.compose, video: { x: 0, y: 0, width: 0 } } },
        2,
      ).ok,
    ).toBe(false);
    expect(
      validateComposeInput({ compose: { ...good.compose, backgroundPng: 'nope' } }, 2).ok,
    ).toBe(false);
    expect(
      validateComposeInput(
        { compose: { ...good.compose, texts: [{ pngs: 5, start: 0, end: 3 }] } },
        2,
      ).ok,
    ).toBe(false);
  });
  test('per-clip png arrays must match the clip count', () => {
    const perClip = {
      compose: {
        ...good.compose,
        texts: [{ pngs: [PNG_DATA_URL], start: 0, end: 3 }],
      },
    };
    expect(validateComposeInput(perClip, 2).ok).toBe(false);
    const okPerClip = {
      compose: {
        ...good.compose,
        texts: [{ pngs: [PNG_DATA_URL, PNG_DATA_URL], start: 0, end: 3 }],
      },
    };
    expect(validateComposeInput(okPerClip, 2).ok).toBe(true);
  });
});

describe('buildComposeFilter', () => {
  test('no texts: scale video onto background', () => {
    expect(buildComposeFilter({ x: 0, y: 656, width: 1080 }, [])).toBe(
      "[0:v]scale=1080:-2[v0];[1:v][v0]overlay=0:656[c0]",
    );
  });
  test('texts chain with enable timing', () => {
    expect(
      buildComposeFilter({ x: 10, y: 20, width: 1000 }, [
        { start: 0, end: 3 },
        { start: 1.5, end: 4 },
      ]),
    ).toBe(
      "[0:v]scale=1000:-2[v0];[1:v][v0]overlay=10:20[c0];" +
        "[c0][2:v]overlay=0:0:enable='between(t,0,3)'[c1];" +
        "[c1][3:v]overlay=0:0:enable='between(t,1.5,4)'[c2]",
    );
  });
  test('rounds odd widths up to even and rounds positions', () => {
    expect(buildComposeFilter({ x: 1.6, y: 2.4, width: 1079 }, [])).toBe(
      "[0:v]scale=1080:-2[v0];[1:v][v0]overlay=2:2[c0]",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/compose-unit.test.ts`
Expected: FAIL — cannot resolve `../../server/compose`.

- [ ] **Step 3: Create `server/jobs.ts`**

```ts
import { randomUUID } from 'node:crypto';

export interface ClipResult {
  fileName: string;
  start: number;
  end: number;
  duration: number;
}

export interface ExportJob {
  id: string;
  status: 'running' | 'done' | 'error';
  percent: number;
  error?: string;
  stderrTail?: string;
  results?: ClipResult[];
  mergedCuts?: number;
  clipIndex?: number;
  clipCount?: number;
}

const jobs = new Map<string, ExportJob>();

export function createJob(): ExportJob {
  const job: ExportJob = { id: randomUUID(), status: 'running', percent: 0 };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): ExportJob | undefined {
  return jobs.get(id);
}
```

- [ ] **Step 4: Create `server/compose.ts` (pure parts only — the runner comes in Task 3)**

```ts
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
```

- [ ] **Step 5: Switch `server/export.ts` to the shared job store**

In `server/export.ts`:
1. Remove the local `ClipResult` and `ExportJob` interface declarations, the `const jobs = new Map<string, ExportJob>()`, the local `getJob` function, and the `randomUUID` import.
2. Add at the top:
```ts
import { createJob, getJob, type ClipResult, type ExportJob } from './jobs';

export { getJob };
export type { ClipResult, ExportJob };
```
3. In `startExport`, replace:
```ts
  const id = randomUUID();
  const job: ExportJob = { id, status: 'running', percent: 0 };
  jobs.set(id, job);
```
with:
```ts
  const job = createJob();
  const id = job.id;
```

- [ ] **Step 6: Run tests to verify they pass (including the untouched export suite)**

Run: `npx vitest run tests/server/compose-unit.test.ts tests/server/export.test.ts`
Expected: PASS — new unit tests green, all 10 existing export tests still green (job-store extraction is behavior-neutral).

- [ ] **Step 7: Full suite + typecheck + commit**

Run: `npm test && npm run typecheck`

```bash
git add server/jobs.ts server/compose.ts server/export.ts tests/server/compose-unit.test.ts
git commit -m "feat: shared job store, compose payload validation, and filter builder"
```

---

### Task 3: Server — vertical export runner, route mode branch, image dialogs, image MIME

**Files:**
- Modify: `server/compose.ts` (append runner), `server/export.ts` (mode branch), `server/app.ts` (json limit), `server/dialogs.ts` (image kind), `server/video.ts` (image MIME entries)
- Test: `tests/server/compose-export.test.ts`, additions to `tests/server/dialogs.test.ts`

**Interfaces:**
- Consumes: Task 2's `ComposeInput`, `decodePngDataUrl`, `buildComposeFilter`, `createJob`; `clampTextTiming` (Task 1); `clipFileName` from `shared/naming`; `ffprobeJson` from `server/video`; `checkConflicts`/`findStaleClips` (existing).
- Produces:
  - `startComposeExport(opts: { sourcePath: string; bounds: number[]; outputDir: string; prefix: string; compose: ComposeInput }): string` — `bounds` is `[0, ...splits, duration]`; returns jobId. Job gains `clipIndex`/`clipCount` while running.
  - `POST /api/export` accepts `mode?: 'lossless' | 'vertical'` (+ `compose` when vertical); vertical conflicts/stale checks use extension `mp4`.
  - `fileDialogCommand(platform: string, kind?: 'video' | 'image')` — image kind uses an image-typed picker; `POST /api/dialog/file` reads `{ kind }` from the body.
  - `GET /api/video/stream` serves `png/jpg/jpeg/webp/bmp` with correct MIME (used by the panel's `<img>` and bake).

- [ ] **Step 1: Write the failing integration tests**

Create `tests/server/compose-export.test.ts`:

```ts
import { beforeAll, describe, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import request from 'supertest';
import type { Express } from 'express';
import ffmpegPath from 'ffmpeg-static';
import { createApp } from '../../server/app';
import { ffprobeJson } from '../../server/video';
import { ensureFixture } from '../helpers/fixture';

const execFileP = promisify(execFile);

let fixture: string;
let bgDataUrl: string;
const app: Express = createApp();

beforeAll(async () => {
  fixture = await ensureFixture();
  const bgPath = path.join(os.tmpdir(), `vc-bg-${process.pid}.png`);
  await execFileP(ffmpegPath!, [
    '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1080x1920', '-frames:v', '1', bgPath,
  ]);
  bgDataUrl = `data:image/png;base64,${fs.readFileSync(bgPath).toString('base64')}`;
});

function tmpOutDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'video-clipper-vtest-'));
}

async function waitForJob(id: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await request(app).get(`/api/export/${id}`);
    expect(res.status).toBe(200);
    if (res.body.status !== 'running') return res.body;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('compose export did not finish within 60s');
}

function verticalBody(outputDir: string, overrides: Record<string, unknown> = {}) {
  return {
    sourcePath: fixture,
    splitTimes: [4],
    outputDir,
    prefix: 'clip',
    overwrite: false,
    mode: 'vertical',
    compose: {
      video: { x: 0, y: 656, width: 1080 },
      backgroundPng: bgDataUrl,
      texts: [{ pngs: bgDataUrl, start: 0, end: 2 }],
    },
    ...overrides,
  };
}

describe('POST /api/export mode=vertical', () => {
  test('re-encodes each clip to 1080x1920 h264 mp4 with accurate durations', async () => {
    const outDir = tmpOutDir();
    const res = await request(app).post('/api/export').send(verticalBody(outDir));
    expect(res.status).toBe(200);
    const job = await waitForJob(res.body.jobId);
    expect(job.status).toBe('done');
    expect(job.clipCount).toBe(2);
    expect(job.results).toHaveLength(2);
    expect(job.results[0].fileName).toBe('01 - clip.mp4');
    expect(job.results[1].fileName).toBe('02 - clip.mp4');
    expect(job.mergedCuts).toBeUndefined();

    let total = 0;
    for (const r of job.results) {
      const probe = await ffprobeJson(path.join(outDir, r.fileName));
      const v = probe.streams.find((s: any) => s.codec_type === 'video');
      expect(v.codec_name).toBe('h264');
      expect(v.width).toBe(1080);
      expect(v.height).toBe(1920);
      total += Number(probe.format.duration);
    }
    // Frame-accurate cutting: first clip ~4s, second ~6s
    expect(job.results[0].duration).toBeGreaterThan(3.85);
    expect(job.results[0].duration).toBeLessThan(4.15);
    expect(total).toBeGreaterThan(9.7);
    expect(total).toBeLessThan(10.3);
  });

  test('400 when compose payload is missing or invalid', async () => {
    const noCompose = await request(app)
      .post('/api/export')
      .send(verticalBody(tmpOutDir(), { compose: undefined }));
    expect(noCompose.status).toBe(400);
    expect(noCompose.body.error).toMatch(/compose/i);

    const badPng = await request(app)
      .post('/api/export')
      .send(
        verticalBody(tmpOutDir(), {
          compose: {
            video: { x: 0, y: 656, width: 1080 },
            backgroundPng: 'nonsense',
            texts: [],
          },
        }),
      );
    expect(badPng.status).toBe(400);
    expect(badPng.body.error).toMatch(/png/i);
  });

  test('409 conflicts use the .mp4 extension in vertical mode', async () => {
    const outDir = tmpOutDir();
    fs.writeFileSync(path.join(outDir, '01 - clip.mp4'), 'existing');
    const res = await request(app).post('/api/export').send(verticalBody(outDir));
    expect(res.status).toBe(409);
    expect(res.body.conflicts).toContain('01 - clip.mp4');
  });

  test('texts entirely outside a clip are dropped, not errored', async () => {
    const outDir = tmpOutDir();
    const res = await request(app)
      .post('/api/export')
      .send(
        verticalBody(outDir, {
          compose: {
            video: { x: 0, y: 656, width: 1080 },
            backgroundPng: bgDataUrl,
            texts: [{ pngs: bgDataUrl, start: 50, end: 60 }], // beyond both clips
          },
        }),
      );
    expect(res.status).toBe(200);
    const job = await waitForJob(res.body.jobId);
    expect(job.status).toBe('done');
    expect(job.results).toHaveLength(2);
  });
});

describe('lossless mode stale-clip handling (regression for prior fix)', () => {
  test('409 lists stale higher-numbered clips; overwrite deletes them', async () => {
    const outDir = tmpOutDir();
    fs.writeFileSync(path.join(outDir, '05 - clip.mp4'), 'stale');
    const first = await request(app).post('/api/export').send({
      sourcePath: fixture,
      splitTimes: [5],
      outputDir: outDir,
      prefix: 'clip',
      overwrite: false,
    });
    expect(first.status).toBe(409);
    expect(first.body.conflicts).toContain('05 - clip.mp4');

    const second = await request(app).post('/api/export').send({
      sourcePath: fixture,
      splitTimes: [5],
      outputDir: outDir,
      prefix: 'clip',
      overwrite: true,
    });
    expect(second.status).toBe(200);
    const job = await waitForJob(second.body.jobId);
    expect(job.status).toBe('done');
    expect(fs.existsSync(path.join(outDir, '05 - clip.mp4'))).toBe(false);
  });
});
```

Note: the lossless fixture is `.mp4`, so stale-clip names in that test use `.mp4` too — that matches `sourceExtension(fixture)`.

- [ ] **Step 2: Add dialog-kind tests**

Append to `tests/server/dialogs.test.ts` (inside the file, as a new describe block):

```ts
describe('fileDialogCommand image kind', () => {
  test('macOS image picker restricts to images', () => {
    const c = fileDialogCommand('darwin', 'image');
    expect(c.args.join(' ')).toContain('public.image');
    expect(c.args.join(' ')).toContain('background image');
  });
  test('Windows image picker filters image extensions', () => {
    const c = fileDialogCommand('win32', 'image');
    expect(c.args.join(' ')).toContain('*.png');
  });
  test('defaults to the video picker', () => {
    const c = fileDialogCommand('darwin');
    expect(c.args.join(' ')).toContain('video');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/server/compose-export.test.ts tests/server/dialogs.test.ts`
Expected: FAIL — vertical mode not implemented (job runs lossless path or 400), dialog kind param missing (TS/arity error).

- [ ] **Step 4: Append the runner to `server/compose.ts`**

Add these imports at the top of `server/compose.ts`:

```ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { clampTextTiming } from '../shared/compose';
import { clipFileName } from '../shared/naming';
import { createJob, type ClipResult, type ExportJob } from './jobs';
import { ffprobeJson } from './video';
```

Append at the end of the file:

```ts
export interface ComposeStartOptions {
  sourcePath: string;
  bounds: number[]; // [0, ...splits, duration] — clip i spans bounds[i-1]..bounds[i]
  outputDir: string;
  prefix: string;
  compose: ComposeInput;
}

export function startComposeExport(opts: ComposeStartOptions): string {
  const job = createJob();
  runCompose(job, opts).catch((err) => {
    job.status = 'error';
    job.error = (err as Error).message;
  });
  return job.id;
}

async function runCompose(job: ExportJob, opts: ComposeStartOptions): Promise<void> {
  const count = opts.bounds.length - 1;
  job.clipCount = count;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-clipper-'));
  try {
    const bgPath = path.join(tmpDir, 'bg.png');
    fs.writeFileSync(bgPath, decodePngDataUrl(opts.compose.backgroundPng)!);

    // textPaths[textIndex][clipIndex-1] — shared texts are written once and reused.
    const textPaths: string[][] = opts.compose.texts.map((t, ti) => {
      if (Array.isArray(t.pngs)) {
        return t.pngs.map((png, ci) => {
          const p = path.join(tmpDir, `text${ti}-${ci + 1}.png`);
          fs.writeFileSync(p, decodePngDataUrl(png)!);
          return p;
        });
      }
      const p = path.join(tmpDir, `text${ti}.png`);
      fs.writeFileSync(p, decodePngDataUrl(t.pngs)!);
      return Array.from({ length: count }, () => p);
    });

    const results: ClipResult[] = [];
    for (let i = 1; i <= count; i++) {
      job.clipIndex = i;
      const start = opts.bounds[i - 1];
      const dur = opts.bounds[i] - start;
      const outName = clipFileName(i, count, opts.prefix, 'mp4');
      const outPath = path.join(opts.outputDir, outName);

      const clipTexts = opts.compose.texts
        .map((t, ti) => ({
          png: textPaths[ti][i - 1],
          timing: clampTextTiming(t.start, t.end, dur),
        }))
        .filter(
          (t): t is { png: string; timing: { start: number; end: number } } =>
            t.timing !== null,
        );

      const filter = buildComposeFilter(opts.compose.video, clipTexts.map((t) => t.timing));
      const args = [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-ss', String(start),
        '-t', String(dur),
        '-i', opts.sourcePath,
        '-i', bgPath,
        ...clipTexts.flatMap((t) => ['-i', t.png]),
        '-filter_complex', filter,
        '-map', `[c${clipTexts.length}]`,
        '-map', '0:a?',
        '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        '-progress', 'pipe:1',
        outPath,
      ];
      await runComposeFfmpeg(job, args, i, count, dur, outName);

      const probe = await ffprobeJson(outPath);
      results.push({
        fileName: outName,
        start,
        end: opts.bounds[i],
        duration: Number(probe.format?.duration ?? dur),
      });
    }
    job.results = results;
    job.percent = 100;
    job.status = 'done';
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function runComposeFfmpeg(
  job: ExportJob,
  args: string[],
  clipIndex: number,
  clipCount: number,
  clipDur: number,
  outName: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath!, args);
    let stderrTail = '';
    proc.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d).slice(-4000);
    });
    proc.stdout.on('data', (d) => {
      for (const line of String(d).split('\n')) {
        const m = /^out_time_us=(\d+)/.exec(line.trim());
        if (m) {
          const clipFraction = Math.min(1, Number(m[1]) / 1e6 / clipDur);
          job.percent = Math.min(99, ((clipIndex - 1 + clipFraction) / clipCount) * 100);
        }
      }
    });
    proc.on('error', (err) => reject(new Error(`Failed to start ffmpeg: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      job.stderrTail = stderrTail;
      reject(new Error(`ffmpeg exited with code ${code} while writing ${outName}`));
    });
  });
}
```

- [ ] **Step 5: Add the mode branch to `server/export.ts`**

Add imports:

```ts
import { startComposeExport, validateComposeInput } from './compose';
```

In the `POST /api/export` handler, after `const count = splits.length + 1;`, change the extension line and add the branch. Replace:

```ts
    const ext = sourceExtension(sourcePath);
```

with:

```ts
    const mode = body.mode === 'vertical' ? 'vertical' : 'lossless';
    const ext = mode === 'vertical' ? 'mp4' : sourceExtension(sourcePath);
```

Then, directly after the existing conflict/stale-clip block (after the `else { … unlinkSync … }`), replace the lossless-only job start:

```ts
    const jobId = startExport({
      sourcePath,
      splits,
      outputDir,
      prefix,
      ext,
      durationSec: info.durationSec,
    });
    res.json({ jobId });
```

with:

```ts
    if (mode === 'vertical') {
      const parsed = validateComposeInput(body, count);
      if (!parsed.ok) return void res.status(400).json({ error: parsed.error });
      const jobId = startComposeExport({
        sourcePath,
        bounds: [0, ...splits, info.durationSec],
        outputDir,
        prefix,
        compose: parsed.value,
      });
      return void res.json({ jobId });
    }

    const jobId = startExport({
      sourcePath,
      splits,
      outputDir,
      prefix,
      ext,
      durationSec: info.durationSec,
    });
    res.json({ jobId });
```

- [ ] **Step 6: Raise the JSON body limit in `server/app.ts`**

Replace `app.use(express.json());` with:

```ts
  // Vertical exports upload baked PNGs as base64 data URLs (a few MB each).
  app.use(express.json({ limit: '100mb' }));
```

- [ ] **Step 7: Image dialog kind in `server/dialogs.ts`**

Change the signature of `fileDialogCommand` to:

```ts
export function fileDialogCommand(
  platform: string,
  kind: 'video' | 'image' = 'video',
): DialogCommand {
```

Inside the `darwin` branch, replace the return with:

```ts
    if (kind === 'image') {
      return {
        cmd: 'osascript',
        args: [
          '-e',
          'POSIX path of (choose file with prompt "Choose a background image" of type {"public.image"})',
        ],
      };
    }
    return {
      cmd: 'osascript',
      args: ['-e', 'POSIX path of (choose file with prompt "Choose a video to split")'],
    };
```

Inside the `win32` branch, replace the `$d.Filter = …` fragment of the PowerShell command string so the filter depends on kind. Build the command with a variable:

```ts
    const filter =
      kind === 'image'
        ? "Image files|*.png;*.jpg;*.jpeg;*.webp;*.bmp|All files|*.*"
        : "Video files|*.mp4;*.m4v;*.mov;*.mkv;*.webm;*.avi;*.wmv;*.ts;*.mts|All files|*.*";
    const title = kind === 'image' ? 'Choose a background image' : 'Choose a video to split';
    return {
      cmd: 'powershell',
      args: [
        '-NoProfile',
        '-STA',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; ' +
          '$d = New-Object System.Windows.Forms.OpenFileDialog; ' +
          `$d.Title = '${title}'; ` +
          `$d.Filter = '${filter}'; ` +
          "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }",
      ],
    };
```

And in the file-dialog route, pass the kind from the body:

```ts
dialogRouter.post('/api/dialog/file', async (req, res) => {
  const kind = req.body?.kind === 'image' ? 'image' : 'video';
  try {
    res.json({ path: await runDialog(fileDialogCommand(process.platform, kind)) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 8: Image MIME entries in `server/video.ts`**

Add to the `MIME` map (used by `<img>` previews of background images and by bake):

```ts
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/server/compose-export.test.ts tests/server/dialogs.test.ts`
Expected: PASS (compose export suite spawns real ffmpeg re-encodes; ~20–40s).

- [ ] **Step 10: Full suite + typecheck + commit**

Run: `npm test && npm run typecheck`
Expected: all green — lossless export suite unchanged.

```bash
git add server/compose.ts server/export.ts server/app.ts server/dialogs.ts server/video.ts tests/server/compose-export.test.ts tests/server/dialogs.test.ts
git commit -m "feat: vertical 9:16 compose export path with per-clip re-encode"
```

---

### Task 4: Fonts + browser baking (`web/src/lib/bake.ts`)

**Files:**
- Modify: `package.json` (fontsource deps), `web/src/main.tsx` (font imports), `web/src/lib/api.ts` (pickFile kind, pickImageFile)
- Create: `web/src/lib/bake.ts`, `web/src/lib/color.ts`

**Interfaces:**
- Consumes: `shared/compose` (Task 1), `streamUrl` from `web/src/lib/api`.
- Produces:
  - `pickFile(kind?: 'video' | 'image'): Promise<string | null>` (default `'video'` — existing callers unchanged).
  - `bake.ts`: `interface BakedText { pngs: string | string[]; start: number; end: number }`, `interface BakedComposition { video: Placement; backgroundPng: string; texts: BakedText[] }`, `bakeComposition(layout: ComposeLayout, clipCount: number): Promise<BakedComposition>`, and the preview-parity constants `TEXT_LINE_HEIGHT = 1.2`, `TEXT_PAD_RATIO = 0.4`, `TEXT_SHADOW_CSS = '0 0 8px rgba(0, 0, 0, 0.8)'`.
  - `color.ts`: `hexToRgba(hex: string, alpha: number): string`.
- Note: baking uses DOM canvas — not unit-testable under the node vitest env. Verification is typecheck + build; correctness is covered by the manual e2e and by the server integration tests consuming the same payload shape.

- [ ] **Step 1: Install the font packages**

```bash
npm install --registry https://registry.npmjs.org/ @fontsource/inter @fontsource/anton @fontsource/bebas-neue @fontsource/archivo-black @fontsource/montserrat @fontsource/oswald @fontsource/bangers @fontsource/roboto-condensed
```

- [ ] **Step 2: Import fonts in `web/src/main.tsx`**

Add after the `styles.css` import:

```tsx
import '@fontsource/inter';
import '@fontsource/inter/600.css';
import '@fontsource/anton';
import '@fontsource/bebas-neue';
import '@fontsource/archivo-black';
import '@fontsource/montserrat';
import '@fontsource/montserrat/700.css';
import '@fontsource/oswald';
import '@fontsource/bangers';
import '@fontsource/roboto-condensed';
```

- [ ] **Step 3: Extend `web/src/lib/api.ts` file picking**

Replace the `post` helper and `pickFile`:

```ts
async function post(url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    ...(body !== undefined && {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  if (!res.ok) throw new Error(await readError(res, `Request failed (${res.status})`));
  return res.json();
}

export async function pickFile(kind: 'video' | 'image' = 'video'): Promise<string | null> {
  return (await post('/api/dialog/file', { kind })).path;
}
```

- [ ] **Step 4: Create `web/src/lib/color.ts`**

```ts
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
```

- [ ] **Step 5: Create `web/src/lib/bake.ts`**

```ts
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
  ctx.textBaseline = 'top';
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
    ctx.fillText(line, t.x, t.y + i * lineHeight + (lineHeight - t.sizePx) / 2);
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
```

- [ ] **Step 6: Typecheck, build, full suite**

Run: `npm run typecheck && npm run build && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json web/src/main.tsx web/src/lib/api.ts web/src/lib/bake.ts web/src/lib/color.ts
git commit -m "feat: bundled fonts, image picking, and browser composition baking"
```

---

### Task 5: Dark editor theme + App shell restructure

**Files:**
- Modify: `web/src/styles.css` (full replacement), `web/src/App.tsx` (full replacement)

**Interfaces:**
- Consumes: all existing components (unchanged props).
- Produces: App layout used by Tasks 6–8: `header.app-header`, `div.workspace` grid with `div.stage-col` (player + split controls + Timeline) and `aside.side-col` (SplitEditor + ExportPanel). All functionality identical — this task is visual + structural only. Existing component class names (`.timeline`, `.segment`, `.split-marker`, `.split-list`, `.split-add`, `.output-row`, `.export-button`, `.progress*`, `.results`, `.stderr`, `.error`, `.notice`, `.muted`, `.player`, `.video-info`, `.split-controls`, `.invalid`) keep working — the new stylesheet restyles them.

- [ ] **Step 1: Replace `web/src/styles.css`**

```css
:root {
  color-scheme: dark;
  --bg: #101014;
  --surface: #17171d;
  --raised: #1f1f28;
  --border: #2b2b38;
  --text: #e9e9f0;
  --muted: #8f8fa0;
  --accent: #6c7bff;
  --accent-strong: #8391ff;
  --danger: #ff5c5c;
  --ok: #3ddc84;
  --radius: 10px;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 14px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
}

main {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 1.25rem 2rem;
}

h1 {
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  margin: 0;
}

h2 {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin: 0 0 0.6rem;
}

button {
  background: var(--raised);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 4px);
  padding: 0.45rem 0.9rem;
  font: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

button:hover:not(:disabled) {
  background: #262633;
  border-color: #3a3a4c;
}

button:disabled {
  opacity: 0.45;
  cursor: default;
}

button.primary,
.export-button {
  background: var(--accent);
  border-color: transparent;
  color: #fff;
  font-weight: 600;
}

button.primary:hover:not(:disabled),
.export-button:hover:not(:disabled) {
  background: var(--accent-strong);
}

input,
select,
textarea {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 4px);
  padding: 0.4rem 0.55rem;
  font: inherit;
}

input:focus-visible,
select:focus-visible,
textarea:focus-visible,
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

input[type='color'] {
  padding: 0.1rem;
  width: 2.4rem;
  height: 2rem;
}

input[type='range'] {
  accent-color: var(--accent);
  padding: 0;
}

.app-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 1rem;
}

.app-header .spacer {
  flex: 1;
}

.video-info {
  color: var(--muted);
  margin: 0;
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.video-info strong {
  color: var(--text);
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 1.25rem;
  align-items: start;
}

.stage-col {
  min-width: 0;
}

.side-col {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.9rem;
}

.mode-toggle {
  display: inline-flex;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 2px);
  padding: 3px;
  gap: 3px;
  margin-bottom: 0.75rem;
}

.mode-toggle button {
  border: none;
  background: transparent;
  color: var(--muted);
  padding: 0.35rem 0.9rem;
}

.mode-toggle button.active {
  background: var(--raised);
  color: var(--text);
}

.player {
  width: 100%;
  max-height: 56vh;
  background: #000;
  border-radius: var(--radius);
  border: 1px solid var(--border);
}

.split-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0.6rem 0;
  color: var(--muted);
}

.timeline {
  position: relative;
  display: flex;
  height: 46px;
  margin: 0.6rem 0;
  border-radius: calc(var(--radius) - 2px);
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
}

.segment {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-width: 0;
  cursor: pointer;
  background: rgba(108, 123, 255, 0.16);
  font-size: 0.72rem;
  white-space: nowrap;
  overflow: hidden;
}

.segment:nth-child(even) {
  background: rgba(108, 123, 255, 0.28);
}

.segment:hover {
  background: rgba(108, 123, 255, 0.45);
}

.segment-duration {
  color: var(--muted);
}

.split-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  margin-left: -4px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: var(--danger);
  cursor: pointer;
}

.split-marker:hover {
  background: #ff8073;
}

.split-list {
  list-style: none;
  padding: 0;
  margin: 0 0 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.split-list li,
.split-add {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.split-list input,
.split-add input {
  width: 8.5rem;
}

input.invalid {
  outline: 2px solid var(--danger);
}

.output-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0.45rem 0;
  min-width: 0;
}

.output-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
}

.muted {
  opacity: 0.6;
}

.export-button {
  width: 100%;
  font-size: 1rem;
  padding: 0.55rem 1.25rem;
  margin: 0.5rem 0;
}

.progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.progress-track {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--raised);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--ok);
  transition: width 0.3s;
}

.error {
  color: var(--danger);
}

.notice {
  color: #e8c15a;
  background: rgba(232, 193, 90, 0.08);
  border: 1px solid rgba(232, 193, 90, 0.25);
  padding: 0.5rem 0.7rem;
  border-radius: calc(var(--radius) - 2px);
  font-size: 0.85rem;
}

.stderr {
  max-height: 12rem;
  overflow: auto;
  font-size: 0.72rem;
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 0.5rem;
  border-radius: calc(var(--radius) - 2px);
  white-space: pre-wrap;
}

.results table {
  border-collapse: collapse;
  width: 100%;
  margin-top: 0.5rem;
  font-size: 0.85rem;
}

.results th,
.results td {
  text-align: left;
  padding: 0.3rem 0.6rem 0.3rem 0;
  border-bottom: 1px solid var(--border);
}

.results th {
  color: var(--muted);
  font-weight: 500;
}

/* ---- Composition stage (Task 6) ---- */

.stage-wrap {
  display: flex;
  justify-content: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.9rem;
}

.stage {
  position: relative;
  aspect-ratio: 9 / 16;
  height: 62vh;
  background: #000;
  overflow: hidden;
  border-radius: 6px;
  touch-action: none;
}

.stage .layer {
  position: absolute;
  cursor: grab;
}

.stage .layer.selected {
  outline: 2px solid var(--accent);
}

.stage .layer video,
.stage .layer img {
  display: block;
  width: 100%;
  height: auto;
  pointer-events: none;
  user-select: none;
}

.stage .text-layer {
  white-space: pre-wrap;
  user-select: none;
}

.resize-handle {
  position: absolute;
  right: -7px;
  bottom: -7px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid #fff;
  cursor: nwse-resize;
}

.transport {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.6rem;
}

.transport input[type='range'] {
  flex: 1;
}

.transport .time {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
}

/* ---- Properties panel (Task 7) ---- */

.prop-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.4rem 0;
}

.prop-row label {
  color: var(--muted);
  font-size: 0.8rem;
  min-width: 4.5rem;
}

.prop-row input[type='number'] {
  width: 5rem;
}

.prop-row textarea {
  flex: 1;
  min-height: 3.2rem;
  resize: vertical;
}

.text-list {
  list-style: none;
  padding: 0;
  margin: 0 0 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.text-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.text-list li button.select {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text-list li.selected button.select {
  border-color: var(--accent);
}

.per-clip-table {
  width: 100%;
  font-size: 0.82rem;
  border-collapse: collapse;
}

.per-clip-table td {
  padding: 0.15rem 0.3rem 0.15rem 0;
}

.per-clip-table input {
  width: 100%;
}
```

- [ ] **Step 2: Replace `web/src/App.tsx`**

Same logic as before, new structure (header + two-column workspace; no mode toggle yet — Task 6 adds it):

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchVideoInfo, pickFile, streamUrl, type VideoInfo } from './lib/api';
import { formatTimestamp } from '../../shared/time';
import { normalizeSplits } from '../../shared/segments';
import { SplitEditor } from './components/SplitEditor';
import { Timeline } from './components/Timeline';
import { ExportPanel } from './components/ExportPanel';

export default function App() {
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [splits, setSplits] = useState<number[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  async function chooseVideo() {
    setError(null);
    try {
      const path = await pickFile();
      if (path === null) return; // user cancelled
      const info = await fetchVideoInfo(path);
      setVideo(info);
      setSplits([]);
      setCurrentTime(0);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const setNormalizedSplits = useCallback(
    (next: number[]) => {
      if (!video) return;
      setSplits(normalizeSplits(next, video.durationSec));
    },
    [video],
  );

  const splitHere = useCallback(() => {
    const el = videoRef.current;
    if (!el || !video) return;
    setSplits((prev) => normalizeSplits([...prev, el.currentTime], video.durationSec));
  }, [video]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 's' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      splitHere();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [splitHere]);

  function seek(t: number) {
    const el = videoRef.current;
    if (el) el.currentTime = t;
  }

  return (
    <main>
      <header className="app-header">
        <h1>Video Clipper</h1>
        {video && (
          <p className="video-info">
            <strong>{video.fileName}</strong> — {formatTimestamp(video.durationSec)} ·{' '}
            {video.width}×{video.height} · {video.videoCodec} · {video.container}
          </p>
        )}
        <div className="spacer" />
        <button onClick={chooseVideo}>{video ? 'Choose another video…' : 'Choose video…'}</button>
      </header>
      {error && <p className="error">{error}</p>}
      {video && (
        <>
          {!video.previewable && (
            <p className="notice">
              This format may not preview in the browser. You can still add split times
              manually and export.
            </p>
          )}
          <div className="workspace">
            <div className="stage-col">
              <video
                ref={videoRef}
                src={streamUrl(video.path)}
                controls
                className="player"
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              />
              <div className="split-controls">
                <button onClick={splitHere}>Split here (S)</button>
                <span>at {formatTimestamp(currentTime)}</span>
              </div>
              <Timeline
                duration={video.durationSec}
                splits={splits}
                onRemoveSplit={(t) => setNormalizedSplits(splits.filter((x) => x !== t))}
                onSeek={seek}
              />
            </div>
            <aside className="side-col">
              <div className="panel">
                <SplitEditor splits={splits} duration={video.durationSec} onChange={setNormalizedSplits} />
              </div>
              <div className="panel">
                <ExportPanel video={video} splits={splits} />
              </div>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Typecheck, build, tests**

Run: `npm run typecheck && npm run build && npm test`
Expected: all green (no component API changed).

- [ ] **Step 4: Visual smoke check**

Run `npm run build`, start `npx tsx server/index.ts` in the background, `curl -s http://localhost:4859/ | grep -o '<script[^>]*>'` to confirm the built bundle serves, kill the server. (Full visual check is deferred to the user.)

- [ ] **Step 5: Commit**

```bash
git add web/src/styles.css web/src/App.tsx
git commit -m "feat: dark editor theme and two-column app shell"
```

---

### Task 6: `CompositionPanel` — the 9:16 stage with drag/resize + mode toggle

**Files:**
- Create: `web/src/components/CompositionPanel.tsx`
- Modify: `web/src/App.tsx` (mode state, layout state, selection state, toggle, conditional stage)

**Interfaces:**
- Consumes: `shared/compose` types + `defaultVideoPlacement`, `placementHeight`, `resolveTextContent`; `TEXT_LINE_HEIGHT`, `TEXT_PAD_RATIO`, `TEXT_SHADOW_CSS` from `web/src/lib/bake`; `hexToRgba` from `web/src/lib/color`; `streamUrl`, `VideoInfo` from api.
- Produces:
  - `type Selection = 'video' | 'background' | { textId: string } | null` (exported from `CompositionPanel.tsx`).
  - `CompositionPanel({ video, videoRef, layout, onLayoutChange, selection, onSelect, onTimeUpdate }: { video: VideoInfo; videoRef: React.RefObject<HTMLVideoElement | null>; layout: ComposeLayout; onLayoutChange: (l: ComposeLayout) => void; selection: Selection; onSelect: (s: Selection) => void; onTimeUpdate: (t: number) => void })`
  - App state consumed by Tasks 7–8: `mode: 'lossless' | 'vertical'`, `layout: ComposeLayout`, `selection: Selection`, setter `updateLayout(patch: Partial<ComposeLayout>)`.

- [ ] **Step 1: Create `web/src/components/CompositionPanel.tsx`**

```tsx
import { useLayoutEffect, useRef, useState } from 'react';
import {
  CANVAS_H,
  CANVAS_W,
  placementHeight,
  resolveTextContent,
  type ComposeLayout,
  type Placement,
  type TextOverlay,
} from '../../../shared/compose';
import { TEXT_LINE_HEIGHT, TEXT_PAD_RATIO, TEXT_SHADOW_CSS } from '../lib/bake';
import { hexToRgba } from '../lib/color';
import { streamUrl, type VideoInfo } from '../lib/api';
import { formatTimestamp } from '../../../shared/time';

export type Selection = 'video' | 'background' | { textId: string } | null;

interface CompositionPanelProps {
  video: VideoInfo;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  layout: ComposeLayout;
  onLayoutChange: (l: ComposeLayout) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onTimeUpdate: (t: number) => void;
}

// Generic pointer-drag: captures the pointer, reports deltas in canvas px.
function startDrag(
  e: React.PointerEvent,
  scale: number,
  onMove: (dxCanvas: number, dyCanvas: number) => void,
) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startY = e.clientY;
  const move = (ev: PointerEvent) =>
    onMove((ev.clientX - startX) / scale, (ev.clientY - startY) / scale);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

export function CompositionPanel({
  video,
  videoRef,
  layout,
  onLayoutChange,
  selection,
  onSelect,
  onTimeUpdate,
}: CompositionPanelProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / CANVAS_W);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const px = (v: number) => v * scale;

  function patchVideo(p: Partial<Placement>) {
    onLayoutChange({ ...layout, video: { ...layout.video, ...p } });
  }

  function patchBackground(p: Partial<Placement>) {
    if (!layout.background) return;
    onLayoutChange({
      ...layout,
      background: { ...layout.background, placement: { ...layout.background.placement, ...p } },
    });
  }

  function patchText(id: string, p: Partial<TextOverlay>) {
    onLayoutChange({
      ...layout,
      texts: layout.texts.map((t) => (t.id === id ? { ...t, ...p } : t)),
    });
  }

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  const videoH = placementHeight(layout.video.width, video.width, video.height);

  return (
    <div>
      <div className="stage-wrap">
        <div ref={stageRef} className="stage" onPointerDown={() => onSelect(null)}>
          {layout.background && (
            <div
              className={`layer ${selection === 'background' ? 'selected' : ''}`}
              style={{
                left: px(layout.background.placement.x),
                top: px(layout.background.placement.y),
                width: px(layout.background.placement.width),
              }}
              onPointerDown={(e) => {
                onSelect('background');
                const base = { ...layout.background!.placement };
                startDrag(e, scale, (dx, dy) => patchBackground({ x: base.x + dx, y: base.y + dy }));
              }}
            >
              <img src={streamUrl(layout.background.path)} alt="" draggable={false} />
              {selection === 'background' && (
                <div
                  className="resize-handle"
                  onPointerDown={(e) => {
                    const base = layout.background!.placement.width;
                    startDrag(e, scale, (dx) =>
                      patchBackground({ width: Math.max(40, base + dx) }),
                    );
                  }}
                />
              )}
            </div>
          )}

          <div
            className={`layer ${selection === 'video' ? 'selected' : ''}`}
            style={{
              left: px(layout.video.x),
              top: px(layout.video.y),
              width: px(layout.video.width),
            }}
            onPointerDown={(e) => {
              onSelect('video');
              const base = { ...layout.video };
              startDrag(e, scale, (dx, dy) => patchVideo({ x: base.x + dx, y: base.y + dy }));
            }}
          >
            <video
              ref={videoRef}
              src={streamUrl(video.path)}
              onTimeUpdate={(e) => {
                setTime(e.currentTarget.currentTime);
                onTimeUpdate(e.currentTarget.currentTime);
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            {selection === 'video' && (
              <div
                className="resize-handle"
                onPointerDown={(e) => {
                  const base = layout.video.width;
                  startDrag(e, scale, (dx) => patchVideo({ width: Math.max(80, base + dx) }));
                }}
              />
            )}
          </div>

          {layout.texts.map((t) => {
            const selected = typeof selection === 'object' && selection?.textId === t.id;
            const pad = t.sizePx * TEXT_PAD_RATIO * scale;
            return (
              <div
                key={t.id}
                className={`layer text-layer ${selected ? 'selected' : ''}`}
                style={{
                  left: px(t.x) - pad,
                  top: px(t.y) - pad,
                  padding: pad,
                  borderRadius: pad / 2,
                  fontFamily: `"${t.font}"`,
                  fontSize: t.sizePx * scale,
                  lineHeight: TEXT_LINE_HEIGHT,
                  color: t.color,
                  background: t.background
                    ? hexToRgba(t.background.color, t.background.opacity)
                    : 'transparent',
                  textShadow: t.shadow ? TEXT_SHADOW_CSS : 'none',
                }}
                onPointerDown={(e) => {
                  onSelect({ textId: t.id });
                  const base = { x: t.x, y: t.y };
                  startDrag(e, scale, (dx, dy) =>
                    patchText(t.id, { x: base.x + dx, y: base.y + dy }),
                  );
                }}
              >
                {resolveTextContent(t, 1)}
              </div>
            );
          })}
        </div>
      </div>

      <div className="transport">
        <button onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
        <input
          type="range"
          min={0}
          max={video.durationSec}
          step={0.05}
          value={time}
          onChange={(e) => {
            const el = videoRef.current;
            if (el) el.currentTime = Number(e.target.value);
          }}
        />
        <span className="time">
          {formatTimestamp(time)} / {formatTimestamp(video.durationSec)}
        </span>
      </div>
      <p className="video-info" style={{ marginTop: '0.4rem' }}>
        Video height on canvas: {Math.round(videoH)}px of {CANVAS_H}px
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Add mode/layout/selection state to `web/src/App.tsx`**

Add imports:

```tsx
import { CompositionPanel, type Selection } from './components/CompositionPanel';
import { defaultVideoPlacement, type ComposeLayout } from '../../shared/compose';
```

Add state (after the existing `useState` lines) and a mode-switch helper that preserves the playhead across the video element remount:

```tsx
  const [mode, setMode] = useState<'lossless' | 'vertical'>('lossless');
  const [layout, setLayout] = useState<ComposeLayout>({
    video: defaultVideoPlacement(16, 9),
    background: null,
    texts: [],
  });
  const [selection, setSelection] = useState<Selection>(null);

  function switchMode(next: 'lossless' | 'vertical') {
    const t = videoRef.current?.currentTime ?? currentTime;
    setMode(next);
    requestAnimationFrame(() => {
      if (videoRef.current) videoRef.current.currentTime = t;
    });
  }
```

In `chooseVideo`, after `setSplits([]);` add (reset composition for the new video's aspect):

```tsx
      setLayout({
        video: defaultVideoPlacement(info.width || 16, info.height || 9),
        background: null,
        texts: [],
      });
      setSelection(null);
```

In the JSX, replace the plain `<video …/>` element inside `.stage-col` with the mode toggle + conditional stage:

```tsx
              <div className="mode-toggle">
                <button
                  className={mode === 'lossless' ? 'active' : ''}
                  onClick={() => switchMode('lossless')}
                >
                  Lossless split
                </button>
                <button
                  className={mode === 'vertical' ? 'active' : ''}
                  onClick={() => switchMode('vertical')}
                >
                  Vertical 9:16
                </button>
              </div>
              {mode === 'lossless' ? (
                <video
                  ref={videoRef}
                  src={streamUrl(video.path)}
                  controls
                  className="player"
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                />
              ) : (
                <CompositionPanel
                  video={video}
                  videoRef={videoRef}
                  layout={layout}
                  onLayoutChange={setLayout}
                  selection={selection}
                  onSelect={setSelection}
                  onTimeUpdate={setCurrentTime}
                />
              )}
```

- [ ] **Step 3: Typecheck, build, tests**

Run: `npm run typecheck && npm run build && npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/CompositionPanel.tsx web/src/App.tsx
git commit -m "feat: 9:16 composition stage with draggable video, background, and texts"
```

---

### Task 7: `PropertiesPanel` — background picking, text add/format/per-clip overrides

**Files:**
- Create: `web/src/components/PropertiesPanel.tsx`
- Modify: `web/src/App.tsx` (render it in the side column when mode is vertical)

**Interfaces:**
- Consumes: `Selection` (Task 6), `ComposeLayout`/`TextOverlay`/`FONTS`/`defaultVideoPlacement` (Task 1), `pickFile('image')` (Task 4).
- Produces: `PropertiesPanel({ layout, onLayoutChange, selection, onSelect, clipCount }: { layout: ComposeLayout; onLayoutChange: (l: ComposeLayout) => void; selection: Selection; onSelect: (s: Selection) => void; clipCount: number })`.

- [ ] **Step 1: Create `web/src/components/PropertiesPanel.tsx`**

```tsx
import { CANVAS_H, CANVAS_W, FONTS, type ComposeLayout, type TextOverlay } from '../../../shared/compose';
import { pickFile } from '../lib/api';
import type { Selection } from './CompositionPanel';

interface PropertiesPanelProps {
  layout: ComposeLayout;
  onLayoutChange: (l: ComposeLayout) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  clipCount: number;
}

function newText(): TextOverlay {
  return {
    id: crypto.randomUUID(),
    content: 'Part {n}',
    perClip: {},
    x: 120,
    y: 220,
    font: 'Anton',
    sizePx: 96,
    color: '#ffffff',
    background: null,
    shadow: true,
    start: 0,
    end: 3600, // clamped to the clip length at export
  };
}

export function PropertiesPanel({
  layout,
  onLayoutChange,
  selection,
  onSelect,
  clipCount,
}: PropertiesPanelProps) {
  const selectedText =
    typeof selection === 'object' && selection
      ? layout.texts.find((t) => t.id === selection.textId) ?? null
      : null;

  function patchText(id: string, p: Partial<TextOverlay>) {
    onLayoutChange({
      ...layout,
      texts: layout.texts.map((t) => (t.id === id ? { ...t, ...p } : t)),
    });
  }

  async function chooseBackground() {
    const path = await pickFile('image').catch(() => null);
    if (!path) return;
    onLayoutChange({
      ...layout,
      background: {
        path,
        placement: { x: 0, y: 0, width: CANVAS_W },
      },
    });
    onSelect('background');
  }

  function addText() {
    const t = newText();
    onLayoutChange({ ...layout, texts: [...layout.texts, t] });
    onSelect({ textId: t.id });
  }

  function num(v: string): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  return (
    <div>
      <h2>Canvas</h2>
      <div className="prop-row">
        <label>Video</label>
        <input
          type="number"
          title="X"
          value={Math.round(layout.video.x)}
          onChange={(e) => onLayoutChange({ ...layout, video: { ...layout.video, x: num(e.target.value) } })}
        />
        <input
          type="number"
          title="Y"
          value={Math.round(layout.video.y)}
          onChange={(e) => onLayoutChange({ ...layout, video: { ...layout.video, y: num(e.target.value) } })}
        />
        <input
          type="number"
          title="Width"
          value={Math.round(layout.video.width)}
          onChange={(e) =>
            onLayoutChange({
              ...layout,
              video: { ...layout.video, width: Math.max(80, num(e.target.value)) },
            })
          }
        />
      </div>

      <div className="prop-row">
        <label>Background</label>
        <button onClick={chooseBackground}>
          {layout.background ? 'Change image…' : 'Choose image…'}
        </button>
        {layout.background && (
          <button onClick={() => onLayoutChange({ ...layout, background: null })}>Remove</button>
        )}
      </div>
      {layout.background && (
        <div className="prop-row">
          <label>Image</label>
          <input
            type="number"
            title="X"
            value={Math.round(layout.background.placement.x)}
            onChange={(e) =>
              onLayoutChange({
                ...layout,
                background: {
                  ...layout.background!,
                  placement: { ...layout.background!.placement, x: num(e.target.value) },
                },
              })
            }
          />
          <input
            type="number"
            title="Y"
            value={Math.round(layout.background.placement.y)}
            onChange={(e) =>
              onLayoutChange({
                ...layout,
                background: {
                  ...layout.background!,
                  placement: { ...layout.background!.placement, y: num(e.target.value) },
                },
              })
            }
          />
          <input
            type="number"
            title="Width"
            value={Math.round(layout.background.placement.width)}
            onChange={(e) =>
              onLayoutChange({
                ...layout,
                background: {
                  ...layout.background!,
                  placement: {
                    ...layout.background!.placement,
                    width: Math.max(40, num(e.target.value)),
                  },
                },
              })
            }
          />
        </div>
      )}

      <h2 style={{ marginTop: '1rem' }}>Texts</h2>
      <ul className="text-list">
        {layout.texts.map((t) => {
          const isSel = typeof selection === 'object' && selection?.textId === t.id;
          return (
            <li key={t.id} className={isSel ? 'selected' : ''}>
              <button className="select" onClick={() => onSelect({ textId: t.id })}>
                {t.content || '(empty)'}
              </button>
              <button
                title="Delete text"
                onClick={() =>
                  onLayoutChange({ ...layout, texts: layout.texts.filter((x) => x.id !== t.id) })
                }
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <button onClick={addText}>Add text</button>

      {selectedText && (
        <div style={{ marginTop: '0.75rem' }}>
          <div className="prop-row">
            <label>Text</label>
            <textarea
              value={selectedText.content}
              onChange={(e) => patchText(selectedText.id, { content: e.target.value })}
            />
          </div>
          {clipCount > 1 && (
            <div className="prop-row">
              <label>Per clip</label>
              <table className="per-clip-table">
                <tbody>
                  {Array.from({ length: clipCount }, (_, i) => i + 1).map((n) => (
                    <tr key={n}>
                      <td>Clip {n}</td>
                      <td>
                        <input
                          placeholder={selectedText.content.replace(/\{n\}/g, String(n))}
                          value={selectedText.perClip[n] ?? ''}
                          onChange={(e) => {
                            const perClip = { ...selectedText.perClip };
                            if (e.target.value === '') delete perClip[n];
                            else perClip[n] = e.target.value;
                            patchText(selectedText.id, { perClip });
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="prop-row">
            <label>Font</label>
            <select
              value={selectedText.font}
              onChange={(e) => patchText(selectedText.id, { font: e.target.value })}
            >
              {FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <input
              type="number"
              title="Size (canvas px)"
              value={selectedText.sizePx}
              onChange={(e) =>
                patchText(selectedText.id, { sizePx: Math.max(12, num(e.target.value)) })
              }
            />
          </div>
          <div className="prop-row">
            <label>Color</label>
            <input
              type="color"
              value={selectedText.color}
              onChange={(e) => patchText(selectedText.id, { color: e.target.value })}
            />
            <label>Shadow</label>
            <input
              type="checkbox"
              checked={selectedText.shadow}
              onChange={(e) => patchText(selectedText.id, { shadow: e.target.checked })}
            />
          </div>
          <div className="prop-row">
            <label>Box</label>
            <input
              type="checkbox"
              checked={selectedText.background !== null}
              onChange={(e) =>
                patchText(selectedText.id, {
                  background: e.target.checked ? { color: '#000000', opacity: 0.6 } : null,
                })
              }
            />
            {selectedText.background && (
              <>
                <input
                  type="color"
                  value={selectedText.background.color}
                  onChange={(e) =>
                    patchText(selectedText.id, {
                      background: { ...selectedText.background!, color: e.target.value },
                    })
                  }
                />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  title="Box opacity"
                  value={selectedText.background.opacity}
                  onChange={(e) =>
                    patchText(selectedText.id, {
                      background: {
                        ...selectedText.background!,
                        opacity: Number(e.target.value),
                      },
                    })
                  }
                />
              </>
            )}
          </div>
          <div className="prop-row">
            <label>Show (s)</label>
            <input
              type="number"
              min={0}
              step={0.1}
              title="Start (seconds into each clip)"
              value={selectedText.start}
              onChange={(e) => patchText(selectedText.id, { start: Math.max(0, num(e.target.value)) })}
            />
            <span>→</span>
            <input
              type="number"
              min={0}
              step={0.1}
              title="End (seconds; clamped to the clip length)"
              value={selectedText.end}
              onChange={(e) => patchText(selectedText.id, { end: Math.max(0, num(e.target.value)) })}
            />
          </div>
          <p className="video-info">
            Times are within each clip. Canvas is {CANVAS_W}×{CANVAS_H}. Use {'{n}'} for the
            clip number.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render it in `web/src/App.tsx`**

Add the import:

```tsx
import { PropertiesPanel } from './components/PropertiesPanel';
```

In the side column, insert a panel above the SplitEditor panel, rendered only in vertical mode:

```tsx
              {mode === 'vertical' && (
                <div className="panel">
                  <PropertiesPanel
                    layout={layout}
                    onLayoutChange={setLayout}
                    selection={selection}
                    onSelect={setSelection}
                    clipCount={splits.length + 1}
                  />
                </div>
              )}
```

- [ ] **Step 3: Typecheck, build, tests**

Run: `npm run typecheck && npm run build && npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/PropertiesPanel.tsx web/src/App.tsx
git commit -m "feat: properties panel for background and text formatting"
```

---

### Task 8: ExportPanel vertical wiring — bake, upload, clip-progress, orphaned-job fix

**Files:**
- Modify: `web/src/lib/api.ts` (mode + compose on ExportRequest; clipIndex/clipCount on ExportJob), `web/src/components/ExportPanel.tsx`, `web/src/App.tsx` (pass mode + layout)

**Interfaces:**
- Consumes: `bakeComposition`/`BakedComposition` (Task 4), `ComposeLayout` (Task 1), server mode branch (Task 3), App's `mode`/`layout` (Tasks 6–7).
- Produces: `ExportPanel({ video, splits, mode, layout })` — in vertical mode it bakes and sends `mode: 'vertical'` + `compose`; shows "Clip i of N"; the video-change reset keeps a running job visible (spec hardening item).

- [ ] **Step 1: Extend `web/src/lib/api.ts`**

Add to `ExportJob`:

```ts
  clipIndex?: number;
  clipCount?: number;
```

Change `ExportRequest` to:

```ts
export interface ExportRequest {
  sourcePath: string;
  splitTimes: number[];
  outputDir: string;
  prefix: string;
  overwrite: boolean;
  mode?: 'lossless' | 'vertical';
  compose?: import('./bake').BakedComposition;
}
```

- [ ] **Step 2: Update `web/src/components/ExportPanel.tsx`**

Add imports:

```tsx
import { bakeComposition, type BakedComposition } from '../lib/bake';
import type { ComposeLayout } from '../../../shared/compose';
```

Change the props interface:

```tsx
interface ExportPanelProps {
  video: VideoInfo;
  splits: number[];
  mode: 'lossless' | 'vertical';
  layout: ComposeLayout;
}

export function ExportPanel({ video, splits, mode, layout }: ExportPanelProps) {
```

Replace the video-change reset effect (orphaned-job fix — a running job stays visible):

```tsx
  useEffect(() => {
    setPrefix(defaultPrefix(video.fileName));
    setError(null);
    setJob((prev) => (prev && prev.status === 'running' ? prev : null));
  }, [video.path, video.fileName]);
```

Change `submitExport` to accept the pre-baked payload and thread mode through:

```tsx
  async function submitExport(overwrite: boolean, compose?: BakedComposition) {
    if (!outputDir) return;
    setError(null);
    try {
      const res = await startExport({
        sourcePath: video.path,
        splitTimes: splits,
        outputDir,
        prefix,
        overwrite,
        mode,
        ...(mode === 'vertical' && compose && { compose }),
      });
      if (res.conflicts) {
        const ok = window.confirm(
          `These files already exist in the output folder:\n\n${res.conflicts.join('\n')}\n\nOverwrite them?`,
        );
        if (ok) await submitExport(true, compose);
        return;
      }
      if (!res.jobId) {
        setError('Export did not return a job id');
        return;
      }
      setJob({ id: res.jobId, status: 'running', percent: 0 });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function doExport(overwrite: boolean) {
    if (submitting) return;
    setSubmitting(true);
    try {
      let compose: BakedComposition | undefined;
      if (mode === 'vertical') {
        compose = await bakeComposition(layout, splits.length + 1);
      }
      await submitExport(overwrite, compose);
    } catch (err) {
      setError((err as Error).message); // bake failure (e.g. unreadable background image)
    } finally {
      setSubmitting(false);
    }
  }
```

Update the export button label and the progress row:

```tsx
      <button className="export-button" disabled={!canExport} onClick={() => doExport(false)}>
        Export {splits.length + 1} clips{mode === 'vertical' ? ' (9:16 MP4)' : ''}
      </button>
```

```tsx
      {job?.status === 'running' && (
        <div className="progress">
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${job.percent}%` }} />
          </div>
          <span>
            {job.clipCount ? `Clip ${job.clipIndex ?? 1} of ${job.clipCount} · ` : ''}
            {Math.round(job.percent)}%
          </span>
        </div>
      )}
```

- [ ] **Step 3: Pass mode + layout from `web/src/App.tsx`**

Change the ExportPanel usage:

```tsx
                <ExportPanel video={video} splits={splits} mode={mode} layout={layout} />
```

- [ ] **Step 4: Typecheck, build, tests**

Run: `npm run typecheck && npm run build && npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/components/ExportPanel.tsx web/src/App.tsx
git commit -m "feat: wire vertical compose export with bake, upload, and clip progress"
```

---

### Task 9: README update + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`**

After the existing numbered usage list (item 4), add a new section before "Works on macOS and Windows…":

```markdown
### Vertical 9:16 mode (TikTok / FB / Shorts)

Switch the toggle above the player to **Vertical 9:16** to compose clips for
vertical platforms:

- Drag and resize the gameplay video on a 1080×1920 canvas.
- Add a background image (drag/scale it behind the video).
- Add text overlays — font, size, color, box, shadow — with per-text show
  times inside each clip. Use `{n}` in a text for the clip number
  ("Part {n}" → "Part 1", "Part 2", …), or override the text per clip.
- One layout applies to every clip; export re-encodes each clip to
  1080×1920 H.264 MP4 (this mode is not lossless — re-encoding is what
  makes the composition possible).

The preview is what ffmpeg renders: backgrounds and texts are rasterized in
the browser and composited by ffmpeg unchanged.
```

Also change the intro line "splits a long video into clips **losslessly**" to mention both modes:

```markdown
A small local web app that splits a long video into clips **losslessly**, or
composes them onto a 1080×1920 vertical canvas (background image + text
overlays) for TikTok/FB — with a dark, editor-style UI.
```

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm run build && npm test`
Expected: everything green (62 original + new compose tests).

- [ ] **Step 3: Manual end-to-end check (deferred to the user)**

With `npm start`: pick a real recording → switch to Vertical 9:16 → drag/resize video → add background image, adjust → add "Part {n}" text, style it, set show times → add 2 splits → export → confirm the mp4s are 1080×1920, match the preview, and play on a phone. Verify lossless mode still exports instantly and identically to before.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document vertical 9:16 compose mode"
```
