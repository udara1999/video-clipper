# Video Clipper

A small local web app that splits a long video into clips **losslessly**, or
composes them onto a 1080×1920 vertical canvas (background image + text
overlays) for TikTok/FB — with a dark, editor-style UI. Lossless splits use
ffmpeg stream copy — no re-encoding, zero quality loss. Cuts snap to the
nearest keyframe at/after each requested split time.

## Usage

```bash
npm install
npm start
```

The app builds the frontend, starts a local server on `http://localhost:4859`
(bound to 127.0.0.1 only), and opens your browser.

1. **Choose video…** — native file picker. The source file is read in place,
   never uploaded or copied, so any file size works.
2. **Mark splits** — press **Split here** (or the `S` key) while
   watching/scrubbing, or type `hh:mm:ss` timestamps. Scroll on the timeline
   to zoom in (up to 1000 px/second) for frame-tight placement on long
   videos — drag a split marker to fine-tune it, hover it for ✕ to delete,
   and click anywhere on the strip to seek there.
3. **Output** — choose a destination folder and an optional clip name prefix
   (defaults to the source filename).
4. **Export** — all segments are written as
   `01 - <prefix>.<ext>`, `02 - <prefix>.<ext>`, … so they sort in timeline
   order. The results list shows each clip's actual keyframe-snapped
   start/end times.

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

Works on macOS and Windows. ffmpeg/ffprobe are bundled via npm packages —
no manual install needed.

## Notes

- Some containers (e.g. certain MKVs) can't be previewed in the browser; the
  app shows a notice, and timestamp-based splitting and export still work.
- Two split times that snap to the same keyframe are merged into one cut, and
  the app tells you.

## Development

```bash
npm run dev:server   # API server with reload on :4859
npm run dev          # Vite dev server with /api proxy
npm test             # unit + integration tests (spawns real ffmpeg)
npm run typecheck
```
