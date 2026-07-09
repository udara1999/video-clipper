# Video Clipper — Design

**Date:** 2026-07-09
**Status:** Approved

## Purpose

A small local web app that splits a long video into clips **losslessly** (no re-encoding, zero quality loss). The user picks a video, marks split points while watching/scrubbing it (or by typing timestamps), confirms, and the clips are written to a folder of their choice, named so they sort in timeline order.

## Requirements

- Personal tool, runs locally on both macOS and Windows.
- No practical file-size limit: the source video is never uploaded or copied — ffmpeg reads it in place and streams output to disk. Memory use is flat regardless of file size.
- Lossless splitting via ffmpeg stream copy; cuts snap to the nearest keyframe at/after each requested split time.
- Split points can be set two ways, kept in sync: a "Split here" button (and `S` key) at the player's current position, and an editable `hh:mm:ss` timestamp list.
- On confirm, **all** segments are exported (no per-segment selection).
- Output files are numbered in timeline order.

## Architecture

New standalone project at `~/Projects/video-clipper`.

### Backend — Node.js + Express

Started with `npm start`; serves the built frontend and auto-opens the browser at `http://localhost:<port>`.

Endpoints:

- `POST /api/dialog/file` — opens the **native** OS file picker and returns the chosen absolute path. macOS: `osascript` (`choose file`); Windows: PowerShell `System.Windows.Forms.OpenFileDialog`.
- `POST /api/dialog/folder` — same, for a destination folder (`choose folder` / `FolderBrowserDialog`).
- `GET /api/video/info?path=` — runs ffprobe; returns duration, container, codec, resolution, and whether the browser can likely preview it.
- `GET /api/video/stream?path=` — streams the file with HTTP Range support so the `<video>` element can scrub large files without loading them fully.
- `POST /api/export` — body: `{ sourcePath, splitTimes[], outputDir, prefix, overwrite }`. Runs a single-pass lossless split:
  `ffmpeg -i <src> -c copy -map 0 -f segment -segment_times t1,t2,... -reset_timestamps 1 <outdir>/<NN> - <prefix>.<ext>`
  Progress is reported to the client (parsed from ffmpeg's `-progress` output) via polling or SSE. The response includes each clip's actual (keyframe-snapped) start/end times, read from the output files with ffprobe.

ffmpeg and ffprobe binaries come from the `ffmpeg-static` / `ffprobe-static` npm packages, which install the correct prebuilt binary per OS — no manual install.

The server binds to `127.0.0.1` only (it can open native dialogs and read local files, so it must not be reachable from the network).

### Frontend — React + Vite + TypeScript

Single screen:

1. **Pick video** → native picker → player loads; filename, duration, resolution, codec shown.
2. **Mark splits** — player with scrubber; "Split here" button + `S` shortcut; editable timestamp list; a timeline strip below the player renders the resulting segments as blocks (Clip 1, Clip 2, … with durations). Clicking a split marker deletes it; clicking a segment seeks the player to its start.
3. **Output** — native folder picker + optional clip name prefix (defaults to source filename).
4. **Confirm & export** → progress bar → results list (file name + actual snapped start/end per clip).

## Output naming

Zero-padded index prefix so files sort in timeline order in any file browser:
`01 - <prefix>.<ext>`, `02 - <prefix>.<ext>`, … Padding width grows with clip count (e.g. 3 digits for 100+ clips). Extension/container matches the source (stream copy preserves it).

## Error handling

- **Existing files:** if any target filename already exists in the output folder, ask the user before overwriting.
- **ffmpeg failure:** surface the tail of ffmpeg's stderr in the UI, not a generic message.
- **Unpreviewable codec/container (e.g. some MKVs):** show a notice; timestamp-list splitting and export remain fully functional.
- **Splits too close together:** two split times that snap to the same keyframe would merge; the app warns and treats them as one cut.
- **Invalid input:** non-existent paths, split times outside the video duration, and malformed timestamps are validated on both client and server.

## Testing

- Unit tests for pure logic: timestamp parsing/formatting, segment computation from split times, output naming/padding.
- Integration test: generate a small synthetic video with ffmpeg (`testsrc`), split it via the export code path, assert the expected files exist and their durations sum to the original.
- Manual end-to-end check with a real long video on macOS (Windows verified via the same code paths — dialogs are the only platform-specific piece).

## Out of scope (YAGNI)

- Frame-accurate re-encode mode.
- Per-segment keep/discard selection.
- Multi-file queueing, trimming, joining, or any editing beyond splitting.
- Hosting/deployment for other users.
