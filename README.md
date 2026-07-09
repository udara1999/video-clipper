# Video Clipper

A small local web app that splits a long video into clips **losslessly** (ffmpeg
stream copy — no re-encoding, zero quality loss). Cuts snap to the nearest
keyframe at/after each requested split time.

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
   watching/scrubbing, or type `hh:mm:ss` timestamps. The timeline strip shows
   the resulting clips; click a red marker to delete a split, click a segment
   to seek to its start.
3. **Output** — choose a destination folder and an optional clip name prefix
   (defaults to the source filename).
4. **Export** — all segments are written as
   `01 - <prefix>.<ext>`, `02 - <prefix>.<ext>`, … so they sort in timeline
   order. The results list shows each clip's actual keyframe-snapped
   start/end times.

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
