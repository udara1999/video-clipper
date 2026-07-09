# Vertical 9:16 Composition & Dark Editor UI — Design

**Date:** 2026-07-09
**Status:** Approved
**Builds on:** `2026-07-09-video-clipper-design.md` (lossless splitter, implemented)

## Purpose

The user uploads game-recording clips to TikTok and Facebook, which want 9:16 vertical video. Add a **Vertical 9:16 compose mode**: a WYSIWYG panel where the gameplay video is placed on a 1080×1920 canvas, a background image fills the space around it (per the mockup in `docs/superpowers/Screenshot 2026-07-09 at 19.04.28.png`), and formatted text overlays are added — then every split clip is exported re-encoded in that layout. Also restyle the whole app as a modern dark video-editor UI.

## Requirements

- **Two export modes**, user-toggled: *Lossless split* (existing behavior, untouched) and *Vertical 9:16* (compose + re-encode). Split-point marking works identically in both.
- **One layout for all clips**; text content may vary per clip via a `{n}` token (replaced with the clip number) and optional per-clip content overrides.
- **Canvas**: fixed 1080×1920 output. The gameplay video is draggable and resizable (aspect locked), initially centered at full canvas width.
- **Background image**: picked from disk (native dialog), draggable and scalable behind the video. Image only (no solid color / blurred-video fill — out of scope).
- **Text overlays**: add/delete/select; drag to position; per-text formatting: font (curated bundled list), size, color, background color + opacity, shadow on/off; per-text **start/end time within the clip** (defaults to whole clip).
- **WYSIWYG guarantee**: what the panel shows is what ffmpeg renders (Approach 1 below).
- **Dark editor restyle** of the entire app: left preview/canvas column, right properties column, consistent controls.
- Lossless mode's output and behavior must not change.

## Approach (decided)

**Browser-rendered overlays + simple ffmpeg composite.** The panel is plain DOM (video element, img, positioned text divs) on a scaled 9:16 stage. On export the browser bakes:

1. the positioned background image into **one 1080×1920 opaque PNG** (offscreen `<canvas>`), and
2. each text overlay into a **full-canvas transparent PNG** (text drawn at its exact position, so ffmpeg overlays at 0,0 — no position math server-side). Texts whose content varies per clip (`{n}` or overrides) are baked once per clip; static texts once.

Because the same browser engine renders preview and PNGs, fonts/shadows/backgrounds match pixel-for-pixel, and ffmpeg never needs font files.

Rejected: pure `drawtext` filters (preview/output drift, per-OS font paths); WebCodecs client-side encoding (complexity, slow, fragile audio).

## Data model (frontend state, `shared/compose.ts` types)

```ts
interface Placement { x: number; y: number; width: number }  // canvas px; height derived from aspect
interface ComposeLayout {
  video: Placement;                 // gameplay placement on the 1080×1920 canvas
  background: { path: string; placement: Placement } | null;  // null → black canvas
  texts: TextOverlay[];
}
interface TextOverlay {
  id: string;
  content: string;                  // may contain {n}
  perClip: Record<number, string>;  // clip index → content override (optional)
  x: number; y: number;             // canvas px, top-left of text block
  font: string;                     // one of the bundled font family names
  sizePx: number;                   // at canvas scale
  color: string;                    // hex
  background: { color: string; opacity: number } | null;
  shadow: boolean;                  // fixed soft shadow (offset 0, blur ~8, black 80%)
  start: number; end: number;       // seconds within the clip; clamped to clip duration at export
}
```

Bundled fonts (woff2 under `web/public/fonts/`, loaded via `@font-face`): Inter, Anton, Bebas Neue, Archivo Black, Montserrat, Oswald, Bangers, Roboto Condensed.

## Architecture

### Frontend

- **Mode toggle** (Lossless / Vertical 9:16) in the export area. Mode `vertical` shows the composition panel; `lossless` shows today's flow.
- **`CompositionPanel`**: the 9:16 stage rendered at a display scale (fits the left column; all stored coordinates are canvas-space, converted by one scale factor). Contains:
  - the existing `<video>` element (same streaming src — the player IS the layer, so scrubbing/split marking still work in compose mode),
  - background `<img>` behind it,
  - text divs; click selects, drag moves, corner handle resizes video/background, text size via properties panel.
- **Properties panel** (right column): context-sensitive — video selected → position/width; background → pick image / position / scale; text → content, per-clip overrides table (clip N → text), font/size/color/background/opacity/shadow, start/end time inputs.
- **Baking** (`web/src/lib/bake.ts`): offscreen 1080×1920 canvas; `document.fonts.load()` before drawing; returns PNGs as base64 data URLs. Pure of app state — takes `ComposeLayout` + clip count, returns `{ backgroundPng, texts: [{ pngPerClip | png, start, end }] }`.
- **Dark editor restyle**: new `styles.css` theme (CSS variables: surface/raised/border/accent/text tokens), app grid `header / [canvas | properties] / timeline strip / export bar`. All existing controls (split list, timeline, export panel) restyled, functionality unchanged.

### Backend

- **`POST /api/export`** gains `mode: 'lossless' | 'vertical'` (default `'lossless'` — backward compatible). For `vertical`, the body adds:
  ```ts
  compose: {
    video: Placement;
    backgroundPng: string;                    // base64 data URL, 1080×1920
    texts: { pngs: string[] | string; start: number; end: number }[];  // pngs: one per clip, or one shared
  }
  ```
  `express.json` limit raised to 100 MB (base64 PNGs are a few MB each; local-only server).
- **`server/compose.ts`**: writes the PNGs to a per-job temp dir (`os.tmpdir()/video-clipper-<jobId>/`), then runs **one ffmpeg per clip** sequentially:
  ```
  ffmpeg -ss <clipStart> -t <clipDur> -i <src> -i bg.png -i text1.png … \
    -filter_complex "[0:v]scale=<w>:-2[v]; [1:v][v]overlay=<x>:<y>[c0]; \
                     [c0][2:v]overlay=0:0:enable='between(t,<s>,<e>)'[c1]; …" \
    -map "[cN]" -map 0:a? -c:v libx264 -crf 18 -preset veryfast -pix_fmt yuv420p \
    -c:a aac -b:a 192k -movflags +faststart <outdir>/<NN - prefix>.mp4
  ```
  - Clip boundaries come from the **actual requested split times** (`-ss`/`-t` accurate seek; re-encoding is frame-accurate, no keyframe snapping — mergedCuts does not apply in this mode).
  - Output is always `.mp4` (H.264/AAC), 1080×1920, source fps.
  - The filter graph is built by a **pure function** `buildComposeFilter(placement, texts): string` (unit-testable).
  - Progress: existing job store; percent = (completedClips + currentClipProgress) / clipCount, parsed from `-progress pipe:1` per run. `ExportJob` gains optional `clipIndex`/`clipCount` for "Clip 2 of 5" display.
  - Temp dir deleted on job completion (success or error).
- **Conflict handling** identical to lossless mode (predicted names, 409, overwrite), with `.mp4` extension.

### Hardening (folded in from the final review)

- **Stale higher-numbered clips**: on export (both modes), files matching `NN - <prefix>.<ext>` with `NN > clipCount` in the output dir are included in the 409 conflict list; on `overwrite: true` they are deleted before ffmpeg runs.
- **Orphaned export on video switch**: switching videos no longer clears a `running` job from the panel — progress stays visible and Export stays disabled until it finishes.

## Error handling

- ffmpeg re-encode failure → existing stderr-tail surfacing per clip; job stops at the failing clip and reports which clip failed.
- Background image file missing/unreadable at bake time → inline panel error; export blocked until fixed or background removed.
- Text `start/end` outside the clip → clamped server-side (`start ≥ 0`, `end ≤ clipDur`, dropped if `start ≥ end` after clamping — the text simply doesn't appear in that clip).
- Invalid compose payload (bad base64, missing fields, non-PNG) → 400 with a specific message.
- Vertical mode with zero splits → same "at least one split" 400 as lossless.

## Testing

- **Unit (pure):** `buildComposeFilter` output for 0/1/2 texts and shared-vs-per-clip PNGs; `{n}` substitution + per-clip override resolution; text time clamping; placement math (canvas↔display scale conversion helpers).
- **Integration:** generate the existing 10s fixture; programmatically create a 1080×1920 PNG background with ffmpeg itself (no new deps): `ffmpeg -f lavfi -i color=c=blue:s=1080x1920 -frames:v 1 bg.png`, and reuse it as a stand-in text PNG; POST a vertical export with one split; assert 2 `.mp4` files exist, ffprobe reports 1080×1920 h264, and durations match the requested split times (±0.15s — frame accuracy, no keyframe snapping).
- **Regression:** full lossless suite must pass unchanged.
- **Manual:** compose a real recording, export, upload-preview on phone.

## Out of scope (YAGNI)

- Solid-color or blurred-video backgrounds; multiple background images.
- Text animations, stickers, emoji pickers, arbitrary font upload.
- Per-clip video/background placement; keyframed movement.
- Other aspect ratios (only 9:16), resolution options (only 1080×1920).
- Audio editing/music overlay.
- Canceling a running export (unchanged from v1).
