# Video Clipper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app that losslessly splits a long video into clips at user-chosen split points, writing keyframe-snapped segments to a chosen folder, numbered in timeline order.

**Architecture:** Node.js + Express backend (native OS dialogs, ffprobe info, HTTP-Range streaming, single-pass ffmpeg stream-copy segment export with polled progress) serving a React + Vite + TypeScript single-screen frontend. Pure logic (timestamps, segments, naming) lives in `shared/` and is imported by both sides.

**Tech Stack:** Node 20+, Express 5, ffmpeg-static, ffprobe-static, open, React 18, Vite, TypeScript (server run via `tsx`), Vitest + Supertest for tests.

**Spec:** `docs/superpowers/specs/2026-07-09-video-clipper-design.md`

## Global Constraints

- Runs locally on both macOS and Windows; the only platform-specific code is the native dialog commands (`osascript` on macOS, PowerShell `System.Windows.Forms` on Windows).
- The server binds to `127.0.0.1` only — never `0.0.0.0`.
- The source video is never uploaded or copied: ffmpeg/ffprobe read it in place; streaming uses HTTP Range so memory stays flat regardless of file size.
- Splitting is lossless: ffmpeg stream copy (`-c copy -map 0 -f segment`), never re-encode. Cuts snap to the nearest keyframe at/after each requested split time.
- Output naming: `NN - <prefix>.<ext>` where the zero-padded index starts at `01` and padding width is `max(2, digits(clipCount))`; extension matches the source container.
- On confirm, **all** segments are exported (no per-segment selection).
- Split times are validated on both client and server (malformed timestamps, non-existent paths, times outside the video duration).
- ffmpeg/ffprobe binaries come from `ffmpeg-static` / `ffprobe-static` npm packages — no manual install.
- Started with `npm start`: builds the frontend, serves it, auto-opens the browser at `http://localhost:4859`.
- TDD for all pure logic and API endpoints; commit at the end of every task.

---

### Task 1: Project scaffolding + Express skeleton + `npm start`

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`
- Create: `server/app.ts`, `server/index.ts`
- Create: `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css`
- Test: `tests/server/app.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `createApp(): express.Express` from `server/app.ts` — every later server task mounts its router inside `createApp` and every server test does `request(createApp())`. Server port is the constant `4859`.

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
dist/
tests/fixtures/
.idea/
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "video-clipper",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Split a long video into lossless clips at chosen timestamps",
  "scripts": {
    "start": "npm run build && tsx server/index.ts",
    "build": "vite build",
    "dev": "vite",
    "dev:server": "tsx watch server/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run:
```bash
cd /Users/udara/Projects/video-clipper
npm install express open ffmpeg-static ffprobe-static react react-dom
npm install -D typescript tsx vite @vitejs/plugin-react vitest supertest @types/express @types/node @types/react @types/react-dom @types/supertest @types/ffprobe-static
```
Expected: both commands exit 0; `package.json` gains `dependencies` and `devDependencies`.

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"]
  },
  "include": ["server", "shared", "web/src", "tests"]
}
```

- [ ] **Step 5: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:4859' } },
});
```

- [ ] **Step 6: Create `vitest.config.ts`**

Export tests spawn real ffmpeg on a 10s file, so give tests a generous timeout.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

- [ ] **Step 7: Write the failing server test**

Create `tests/server/app.test.ts`:

```ts
import { expect, test } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app';

test('GET /api/health responds ok', async () => {
  const res = await request(createApp()).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run tests/server/app.test.ts`
Expected: FAIL — cannot resolve `../../server/app`.

- [ ] **Step 9: Create `server/app.ts`**

```ts
import express from 'express';
import { fileURLToPath } from 'node:url';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(express.static(distDir));
  return app;
}
```

- [ ] **Step 10: Create `server/index.ts`**

The `127.0.0.1` bind is a security requirement — this server opens native dialogs and reads arbitrary local files, so it must not be reachable from the network.

```ts
import open from 'open';
import { createApp } from './app';

const PORT = 4859;

createApp().listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Video Clipper running at ${url}`);
  open(url).catch(() => {
    console.log('Could not auto-open a browser; open the URL above manually.');
  });
});
```

- [ ] **Step 11: Create the minimal frontend**

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Video Clipper</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`web/src/App.tsx`:

```tsx
export default function App() {
  return (
    <main>
      <h1>Video Clipper</h1>
    </main>
  );
}
```

`web/src/styles.css`:

```css
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
}
body {
  margin: 0;
}
main {
  max-width: 960px;
  margin: 0 auto;
  padding: 1.5rem;
}
.error {
  color: #c0392b;
}
.notice {
  color: #8a6d00;
  background: rgba(255, 200, 0, 0.15);
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run tests/server/app.test.ts`
Expected: PASS (1 test).

- [ ] **Step 13: Verify `npm start` works end-to-end**

Run: `npm start`
Expected: Vite builds into `dist/`, console prints `Video Clipper running at http://localhost:4859`, browser opens showing the "Video Clipper" heading. Ctrl-C to stop.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat: scaffold Express server and Vite React frontend"
```

---

### Task 2: `shared/time.ts` — timestamp parsing and formatting

**Files:**
- Create: `shared/time.ts`
- Test: `tests/shared/time.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseTimestamp(input: string): number | null` — accepts `hh:mm:ss`, `mm:ss`, plain seconds, each with optional `.fff` fraction on the last part; returns seconds as a float, or `null` for malformed input (empty, letters, minutes/seconds ≥ 60 in colon form, more than 3 parts).
  - `formatTimestamp(seconds: number): string` — returns `hh:mm:ss` (zero-padded, hours can exceed 99) with a trailing `.fff` fraction (trailing zeros trimmed) only when non-integral. Negative input clamps to `00:00:00`.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/time.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { formatTimestamp, parseTimestamp } from '../../shared/time';

describe('parseTimestamp', () => {
  test('parses hh:mm:ss', () => {
    expect(parseTimestamp('01:02:03')).toBe(3723);
  });

  test('parses mm:ss', () => {
    expect(parseTimestamp('02:03')).toBe(123);
  });

  test('parses plain seconds', () => {
    expect(parseTimestamp('45')).toBe(45);
    expect(parseTimestamp('90')).toBe(90);
  });

  test('parses fractional seconds', () => {
    expect(parseTimestamp('01:02:03.5')).toBe(3723.5);
    expect(parseTimestamp('3.25')).toBe(3.25);
  });

  test('tolerates surrounding whitespace and single-digit parts', () => {
    expect(parseTimestamp(' 1:2:3 ')).toBe(3723);
  });

  test('rejects malformed input', () => {
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('abc')).toBeNull();
    expect(parseTimestamp('1:2:3:4')).toBeNull();
    expect(parseTimestamp('1:75')).toBeNull(); // seconds >= 60 in colon form
    expect(parseTimestamp('1:75:00')).toBeNull(); // minutes >= 60 in colon form
    expect(parseTimestamp('1:')).toBeNull();
    expect(parseTimestamp('1.5:00')).toBeNull(); // only last part may be fractional
  });
});

describe('formatTimestamp', () => {
  test('formats whole seconds as hh:mm:ss', () => {
    expect(formatTimestamp(3723)).toBe('01:02:03');
    expect(formatTimestamp(0)).toBe('00:00:00');
    expect(formatTimestamp(59)).toBe('00:00:59');
  });

  test('formats fractional seconds with trimmed millis', () => {
    expect(formatTimestamp(3723.5)).toBe('01:02:03.5');
    expect(formatTimestamp(1.25)).toBe('00:00:01.25');
  });

  test('rounds sub-millisecond noise instead of cascading', () => {
    expect(formatTimestamp(59.9999)).toBe('00:01:00');
  });

  test('clamps negatives to zero', () => {
    expect(formatTimestamp(-3)).toBe('00:00:00');
  });

  test('round-trips through parse', () => {
    for (const t of [0, 1, 61, 3723.5, 7200.125]) {
      expect(parseTimestamp(formatTimestamp(t))).toBe(t);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/time.test.ts`
Expected: FAIL — cannot resolve `../../shared/time`.

- [ ] **Step 3: Create `shared/time.ts`**

```ts
export function parseTimestamp(input: string): number | null {
  const s = input.trim();
  if (!/^[\d:.]+$/.test(s)) return null;
  const parts = s.split(':');
  if (parts.length > 3 || parts.some((p) => p === '')) return null;
  // Only the last part may be fractional.
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i].includes('.')) return null;
  }
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (parts.length >= 2) {
    if (nums[nums.length - 1] >= 60) return null;
    if (nums[nums.length - 2] >= 60) return null;
  }
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatTimestamp(seconds: number): string {
  const totalMs = Math.round(Math.max(0, seconds) * 1000);
  const ms = totalMs % 1000;
  const totalSec = (totalMs - ms) / 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const frac = ms ? '.' + String(ms).padStart(3, '0').replace(/0+$/, '') : '';
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':') + frac;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/time.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add shared/time.ts tests/shared/time.test.ts
git commit -m "feat: timestamp parsing and formatting"
```

---

### Task 3: `shared/segments.ts` — segment computation from split times

**Files:**
- Create: `shared/segments.ts`
- Test: `tests/shared/segments.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Segment { index: number; start: number; end: number; duration: number }` — `index` is 1-based.
  - `normalizeSplits(times: number[], duration: number): number[]` — sorted ascending, deduped within 0.01s epsilon, entries outside `(0, duration)` (exclusive, with epsilon) dropped.
  - `computeSegments(splits: number[], duration: number): Segment[]` — normalizes, then returns `splits.length + 1` segments covering `[0, duration]` with no gaps.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/segments.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { computeSegments, normalizeSplits } from '../../shared/segments';

describe('normalizeSplits', () => {
  test('sorts ascending', () => {
    expect(normalizeSplits([6, 3], 10)).toEqual([3, 6]);
  });

  test('dedupes near-identical times', () => {
    expect(normalizeSplits([3, 3.005, 3], 10)).toEqual([3]);
  });

  test('drops times outside (0, duration)', () => {
    expect(normalizeSplits([0, -1, 10, 15, 5], 10)).toEqual([5]);
  });

  test('empty input gives empty output', () => {
    expect(normalizeSplits([], 10)).toEqual([]);
  });
});

describe('computeSegments', () => {
  test('no splits yields one full segment', () => {
    expect(computeSegments([], 10)).toEqual([
      { index: 1, start: 0, end: 10, duration: 10 },
    ]);
  });

  test('n splits yield n+1 contiguous segments', () => {
    const segs = computeSegments([3, 6], 10);
    expect(segs).toEqual([
      { index: 1, start: 0, end: 3, duration: 3 },
      { index: 2, start: 3, end: 6, duration: 3 },
      { index: 3, start: 6, end: 10, duration: 4 },
    ]);
  });

  test('normalizes unsorted, duplicated, out-of-range splits first', () => {
    const segs = computeSegments([6, 3, 3, 99], 10);
    expect(segs.map((s) => s.start)).toEqual([0, 3, 6]);
    expect(segs.map((s) => s.end)).toEqual([3, 6, 10]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/segments.test.ts`
Expected: FAIL — cannot resolve `../../shared/segments`.

- [ ] **Step 3: Create `shared/segments.ts`**

```ts
export interface Segment {
  index: number;
  start: number;
  end: number;
  duration: number;
}

const EPSILON = 0.01;

export function normalizeSplits(times: number[], duration: number): number[] {
  const valid = times
    .filter((t) => t > EPSILON && t < duration - EPSILON)
    .sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of valid) {
    if (out.length === 0 || t - out[out.length - 1] > EPSILON) out.push(t);
  }
  return out;
}

export function computeSegments(splits: number[], duration: number): Segment[] {
  const bounds = [0, ...normalizeSplits(splits, duration), duration];
  const segments: Segment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    segments.push({
      index: i + 1,
      start: bounds[i],
      end: bounds[i + 1],
      duration: bounds[i + 1] - bounds[i],
    });
  }
  return segments;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/segments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/segments.ts tests/shared/segments.test.ts
git commit -m "feat: segment computation from split times"
```

---

### Task 4: `shared/naming.ts` — output naming and padding

**Files:**
- Create: `shared/naming.ts`
- Test: `tests/shared/naming.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `padWidth(count: number): number` — `max(2, digits in count)`.
  - `clipFileName(index: number, count: number, prefix: string, ext: string): string` — `"01 - prefix.mp4"` style; `index` is 1-based.
  - `segmentPattern(count: number, prefix: string, ext: string): string` — ffmpeg printf pattern `"%02d - prefix.mp4"`; literal `%` in the prefix is escaped as `%%`.
  - `defaultPrefix(sourceFileName: string): string` — filename minus its last extension.
  - `sourceExtension(sourcePath: string): string` — extension without the dot; falls back to `'mp4'` if none.
  - `sanitizePrefix(prefix: string): string` — strips characters illegal in filenames (`\ / : * ? " < > |`), trims; returns `'clip'` if nothing remains.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/naming.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  clipFileName,
  defaultPrefix,
  padWidth,
  sanitizePrefix,
  segmentPattern,
  sourceExtension,
} from '../../shared/naming';

describe('padWidth', () => {
  test('minimum width is 2', () => {
    expect(padWidth(1)).toBe(2);
    expect(padWidth(9)).toBe(2);
    expect(padWidth(99)).toBe(2);
  });

  test('grows with clip count', () => {
    expect(padWidth(100)).toBe(3);
    expect(padWidth(1000)).toBe(4);
  });
});

describe('clipFileName', () => {
  test('formats zero-padded index, prefix, extension', () => {
    expect(clipFileName(1, 12, 'movie', 'mp4')).toBe('01 - movie.mp4');
    expect(clipFileName(12, 12, 'movie', 'mp4')).toBe('12 - movie.mp4');
    expect(clipFileName(7, 120, 'movie', 'mkv')).toBe('007 - movie.mkv');
  });
});

describe('segmentPattern', () => {
  test('builds ffmpeg printf pattern with matching width', () => {
    expect(segmentPattern(12, 'movie', 'mp4')).toBe('%02d - movie.mp4');
    expect(segmentPattern(120, 'movie', 'mp4')).toBe('%03d - movie.mp4');
  });

  test('escapes percent signs in the prefix', () => {
    expect(segmentPattern(2, '100% done', 'mp4')).toBe('%02d - 100%% done.mp4');
  });
});

describe('defaultPrefix', () => {
  test('strips only the last extension', () => {
    expect(defaultPrefix('my.video.mp4')).toBe('my.video');
    expect(defaultPrefix('clip.mkv')).toBe('clip');
    expect(defaultPrefix('noext')).toBe('noext');
  });
});

describe('sourceExtension', () => {
  test('returns the extension without the dot', () => {
    expect(sourceExtension('/a/b/clip.mp4')).toBe('mp4');
    expect(sourceExtension('C:\\videos\\clip.MKV')).toBe('MKV');
  });

  test('falls back to mp4 when there is none', () => {
    expect(sourceExtension('/a/b/noext')).toBe('mp4');
  });
});

describe('sanitizePrefix', () => {
  test('strips filename-illegal characters and trims', () => {
    expect(sanitizePrefix('a/b:c*d?e"f<g>h|i\\j')).toBe('abcdefghij');
    expect(sanitizePrefix('  padded  ')).toBe('padded');
  });

  test('falls back to clip when nothing remains', () => {
    expect(sanitizePrefix('???')).toBe('clip');
    expect(sanitizePrefix('')).toBe('clip');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/naming.test.ts`
Expected: FAIL — cannot resolve `../../shared/naming`.

- [ ] **Step 3: Create `shared/naming.ts`**

```ts
export function padWidth(count: number): number {
  return Math.max(2, String(count).length);
}

export function clipFileName(index: number, count: number, prefix: string, ext: string): string {
  return `${String(index).padStart(padWidth(count), '0')} - ${prefix}.${ext}`;
}

export function segmentPattern(count: number, prefix: string, ext: string): string {
  return `%0${padWidth(count)}d - ${prefix.replace(/%/g, '%%')}.${ext}`;
}

export function defaultPrefix(sourceFileName: string): string {
  return sourceFileName.replace(/\.[^.]+$/, '');
}

export function sourceExtension(sourcePath: string): string {
  const m = sourcePath.match(/\.([^./\\]+)$/);
  return m ? m[1] : 'mp4';
}

export function sanitizePrefix(prefix: string): string {
  const clean = prefix.replace(/[\\/:*?"<>|]/g, '').trim();
  return clean === '' ? 'clip' : clean;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/naming.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/naming.ts tests/shared/naming.test.ts
git commit -m "feat: output clip naming and padding"
```

---

### Task 5: Native dialog endpoints

**Files:**
- Create: `server/dialogs.ts`
- Modify: `server/app.ts` (mount router)
- Test: `tests/server/dialogs.test.ts`

**Interfaces:**
- Consumes: `createApp()` from Task 1.
- Produces:
  - `interface DialogCommand { cmd: string; args: string[] }`
  - `fileDialogCommand(platform: string): DialogCommand` and `folderDialogCommand(platform: string): DialogCommand` — pure builders, throw on platforms other than `'darwin'`/`'win32'`.
  - `dialogRouter: express.Router` mounting `POST /api/dialog/file` and `POST /api/dialog/folder`, each responding `{ path: string | null }` (`null` = user cancelled) or `500 { error }` on unsupported platform.

- [ ] **Step 1: Write the failing tests for the pure command builders**

Create `tests/server/dialogs.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { fileDialogCommand, folderDialogCommand } from '../../server/dialogs';

describe('fileDialogCommand', () => {
  test('macOS uses osascript choose file', () => {
    const c = fileDialogCommand('darwin');
    expect(c.cmd).toBe('osascript');
    expect(c.args.join(' ')).toContain('choose file');
    expect(c.args.join(' ')).toContain('POSIX path');
  });

  test('Windows uses PowerShell OpenFileDialog', () => {
    const c = fileDialogCommand('win32');
    expect(c.cmd).toBe('powershell');
    expect(c.args).toContain('-STA');
    expect(c.args.join(' ')).toContain('OpenFileDialog');
  });

  test('throws on unsupported platforms', () => {
    expect(() => fileDialogCommand('linux')).toThrow(/not supported/);
  });
});

describe('folderDialogCommand', () => {
  test('macOS uses osascript choose folder', () => {
    const c = folderDialogCommand('darwin');
    expect(c.cmd).toBe('osascript');
    expect(c.args.join(' ')).toContain('choose folder');
  });

  test('Windows uses PowerShell FolderBrowserDialog', () => {
    const c = folderDialogCommand('win32');
    expect(c.cmd).toBe('powershell');
    expect(c.args.join(' ')).toContain('FolderBrowserDialog');
  });

  test('throws on unsupported platforms', () => {
    expect(() => folderDialogCommand('linux')).toThrow(/not supported/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/dialogs.test.ts`
Expected: FAIL — cannot resolve `../../server/dialogs`.

- [ ] **Step 3: Create `server/dialogs.ts`**

```ts
import { spawn } from 'node:child_process';
import { Router } from 'express';

export interface DialogCommand {
  cmd: string;
  args: string[];
}

export function fileDialogCommand(platform: string): DialogCommand {
  if (platform === 'darwin') {
    return {
      cmd: 'osascript',
      args: ['-e', 'POSIX path of (choose file with prompt "Choose a video to split")'],
    };
  }
  if (platform === 'win32') {
    return {
      cmd: 'powershell',
      args: [
        '-NoProfile',
        '-STA',
        '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; " +
          "$d = New-Object System.Windows.Forms.OpenFileDialog; " +
          "$d.Title = 'Choose a video to split'; " +
          "$d.Filter = 'Video files|*.mp4;*.m4v;*.mov;*.mkv;*.webm;*.avi;*.wmv;*.ts;*.mts|All files|*.*'; " +
          "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }",
      ],
    };
  }
  throw new Error(`Native dialogs are not supported on platform "${platform}"`);
}

export function folderDialogCommand(platform: string): DialogCommand {
  if (platform === 'darwin') {
    return {
      cmd: 'osascript',
      args: ['-e', 'POSIX path of (choose folder with prompt "Choose an output folder")'],
    };
  }
  if (platform === 'win32') {
    return {
      cmd: 'powershell',
      args: [
        '-NoProfile',
        '-STA',
        '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; " +
          "$d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
          "$d.Description = 'Choose an output folder'; " +
          "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }",
      ],
    };
  }
  throw new Error(`Native dialogs are not supported on platform "${platform}"`);
}

// Cancelling produces no stdout (osascript exits 1, PowerShell prints nothing) → null.
function runDialog(command: DialogCommand): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(command.cmd, command.args);
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d;
    });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const chosen = out.trim();
      resolve(chosen === '' ? null : chosen);
    });
  });
}

export const dialogRouter = Router();

dialogRouter.post('/api/dialog/file', async (_req, res) => {
  try {
    res.json({ path: await runDialog(fileDialogCommand(process.platform)) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

dialogRouter.post('/api/dialog/folder', async (_req, res) => {
  try {
    res.json({ path: await runDialog(folderDialogCommand(process.platform)) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 4: Mount the router in `server/app.ts`**

Add the import and `app.use` line so `createApp` becomes:

```ts
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dialogRouter } from './dialogs';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(dialogRouter);
  app.use(express.static(distDir));
  return app;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/server/dialogs.test.ts tests/server/app.test.ts`
Expected: PASS.

- [ ] **Step 6: Manually verify the native dialog opens**

Run: `npm run dev:server` then in another terminal:
```bash
curl -s -X POST http://localhost:4859/api/dialog/file
```
Expected: a native macOS file picker appears; choosing a file returns `{"path":"/…/file.ext"}`; cancelling returns `{"path":null}`. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add server/dialogs.ts server/app.ts tests/server/dialogs.test.ts
git commit -m "feat: native file and folder picker endpoints"
```

---

### Task 6: Test fixture helper + `GET /api/video/info`

**Files:**
- Create: `tests/helpers/fixture.ts`, `server/video.ts`
- Modify: `server/app.ts` (mount router)
- Test: `tests/server/video-info.test.ts`

**Interfaces:**
- Consumes: `createApp()` (Task 1), `sourceExtension` from `shared/naming` (Task 4).
- Produces:
  - `ensureFixture(): Promise<string>` from `tests/helpers/fixture.ts` — generates (once) and returns the absolute path of a 10-second 320×240 h264 mp4 with a keyframe every second (`testsrc`, gop 30 @ 30fps). Used by Tasks 7 and 8 tests.
  - `ffprobeJson(filePath: string): Promise<any>` — raw ffprobe `-show_format -show_streams` JSON.
  - `isLikelyPreviewable(ext: string, videoCodec: string): boolean` — pure heuristic.
  - `getVideoInfo(filePath: string): Promise<VideoInfo>` where `interface VideoInfo { path: string; fileName: string; durationSec: number; container: string; videoCodec: string; audioCodec: string | null; width: number; height: number; previewable: boolean }`.
  - `videoRouter: express.Router` mounting `GET /api/video/info?path=` → `VideoInfo` JSON, `404 { error }` for missing files, `500 { error }` on probe failure. (Task 7 adds the stream route to this same router.)

- [ ] **Step 1: Create `tests/helpers/fixture.ts`**

```ts
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const execFileP = promisify(execFile);

export const FIXTURE = fileURLToPath(new URL('../fixtures/test-10s.mp4', import.meta.url));

// 10s synthetic video, keyframe every second (gop 30 at 30fps) so tests can
// reason about where cuts snap.
export async function ensureFixture(): Promise<string> {
  if (fs.existsSync(FIXTURE)) return FIXTURE;
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  await execFileP(ffmpegPath!, [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc=duration=10:size=320x240:rate=30',
    '-c:v', 'libx264',
    '-g', '30',
    '-pix_fmt', 'yuv420p',
    FIXTURE,
  ]);
  return FIXTURE;
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/server/video-info.test.ts`:

```ts
import { beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app';
import { isLikelyPreviewable } from '../../server/video';
import { ensureFixture } from '../helpers/fixture';

let fixture: string;

beforeAll(async () => {
  fixture = await ensureFixture();
});

describe('isLikelyPreviewable', () => {
  test('mp4 + h264 is previewable', () => {
    expect(isLikelyPreviewable('mp4', 'h264')).toBe(true);
    expect(isLikelyPreviewable('MP4', 'H264')).toBe(true);
    expect(isLikelyPreviewable('webm', 'vp9')).toBe(true);
  });

  test('mkv or exotic codecs are not', () => {
    expect(isLikelyPreviewable('mkv', 'h264')).toBe(false);
    expect(isLikelyPreviewable('mp4', 'mpeg2video')).toBe(false);
  });
});

describe('GET /api/video/info', () => {
  test('returns duration, codec, resolution, previewability', async () => {
    const res = await request(createApp()).get('/api/video/info').query({ path: fixture });
    expect(res.status).toBe(200);
    expect(res.body.fileName).toBe('test-10s.mp4');
    expect(res.body.durationSec).toBeGreaterThan(9.5);
    expect(res.body.durationSec).toBeLessThan(10.5);
    expect(res.body.videoCodec).toBe('h264');
    expect(res.body.width).toBe(320);
    expect(res.body.height).toBe(240);
    expect(res.body.container).toBe('mp4');
    expect(res.body.previewable).toBe(true);
  });

  test('404 for a non-existent path', async () => {
    const res = await request(createApp()).get('/api/video/info').query({ path: '/nope/missing.mp4' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/server/video-info.test.ts`
Expected: FAIL — cannot resolve `../../server/video`.

- [ ] **Step 4: Create `server/video.ts`**

```ts
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router } from 'express';
import ffprobeStatic from 'ffprobe-static';
import { sourceExtension } from '../shared/naming';

const execFileP = promisify(execFile);

export async function ffprobeJson(filePath: string): Promise<any> {
  const { stdout } = await execFileP(
    ffprobeStatic.path,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

export function isLikelyPreviewable(ext: string, videoCodec: string): boolean {
  const containerOk = ['mp4', 'm4v', 'mov', 'webm'].includes(ext.toLowerCase());
  const codecOk = ['h264', 'vp8', 'vp9', 'av1'].includes(videoCodec.toLowerCase());
  return containerOk && codecOk;
}

export interface VideoInfo {
  path: string;
  fileName: string;
  durationSec: number;
  container: string;
  videoCodec: string;
  audioCodec: string | null;
  width: number;
  height: number;
  previewable: boolean;
}

export async function getVideoInfo(filePath: string): Promise<VideoInfo> {
  const probe = await ffprobeJson(filePath);
  const streams: any[] = probe.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('No video stream found in file');
  const a = streams.find((s) => s.codec_type === 'audio');
  const ext = sourceExtension(filePath);
  return {
    path: filePath,
    fileName: path.basename(filePath),
    durationSec: Number(probe.format?.duration ?? 0),
    container: ext,
    videoCodec: v.codec_name ?? 'unknown',
    audioCodec: a?.codec_name ?? null,
    width: v.width ?? 0,
    height: v.height ?? 0,
    previewable: isLikelyPreviewable(ext, v.codec_name ?? ''),
  };
}

export const videoRouter = Router();

videoRouter.get('/api/video/info', async (req, res) => {
  const filePath = String(req.query.path ?? '');
  if (filePath === '' || !fs.existsSync(filePath)) {
    return void res.status(404).json({ error: 'File not found' });
  }
  try {
    res.json(await getVideoInfo(filePath));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 5: Mount the router in `server/app.ts`**

Add `import { videoRouter } from './video';` next to the dialog import, and `app.use(videoRouter);` directly after `app.use(dialogRouter);`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/server/video-info.test.ts`
Expected: PASS (first run takes a few seconds while ffmpeg generates the fixture into `tests/fixtures/`, which is gitignored).

- [ ] **Step 7: Commit**

```bash
git add tests/helpers/fixture.ts server/video.ts server/app.ts tests/server/video-info.test.ts
git commit -m "feat: video info endpoint via ffprobe"
```

---

### Task 7: `GET /api/video/stream` with HTTP Range support

**Files:**
- Modify: `server/video.ts` (add MIME map + stream route to `videoRouter`)
- Test: `tests/server/video-stream.test.ts`

**Interfaces:**
- Consumes: `videoRouter`, `sourceExtension`, `ensureFixture` from earlier tasks.
- Produces: `GET /api/video/stream?path=` — `206` + `Content-Range` for Range requests, `200` + `Content-Length` without, `404 { error }` for missing files, `416` for unsatisfiable ranges. The frontend uses this as the `<video src>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/server/video-stream.test.ts`:

```ts
import { beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import request from 'supertest';
import { createApp } from '../../server/app';
import { ensureFixture } from '../helpers/fixture';

let fixture: string;

beforeAll(async () => {
  fixture = await ensureFixture();
});

describe('GET /api/video/stream', () => {
  test('serves a byte range with 206', async () => {
    const res = await request(createApp())
      .get('/api/video/stream')
      .query({ path: fixture })
      .set('Range', 'bytes=0-99')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-99/${fs.statSync(fixture).size}`);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect((res.body as Buffer).length).toBe(100);
  });

  test('serves an open-ended range to EOF', async () => {
    const size = fs.statSync(fixture).size;
    const res = await request(createApp())
      .get('/api/video/stream')
      .query({ path: fixture })
      .set('Range', `bytes=${size - 50}-`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(206);
    expect((res.body as Buffer).length).toBe(50);
  });

  test('serves the whole file with 200 when no Range is sent', async () => {
    const res = await request(createApp())
      .get('/api/video/stream')
      .query({ path: fixture })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(Number(res.headers['content-length'])).toBe(fs.statSync(fixture).size);
    expect(res.headers['content-type']).toBe('video/mp4');
  });

  test('416 for an unsatisfiable range', async () => {
    const res = await request(createApp())
      .get('/api/video/stream')
      .query({ path: fixture })
      .set('Range', 'bytes=999999999-');
    expect(res.status).toBe(416);
  });

  test('404 for a missing file', async () => {
    const res = await request(createApp())
      .get('/api/video/stream')
      .query({ path: '/nope/missing.mp4' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/video-stream.test.ts`
Expected: FAIL — route does not exist yet (404 where 206/200 expected).

- [ ] **Step 3: Add the stream route to `server/video.ts`**

Append at the end of the file:

```ts
const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  wmv: 'video/x-ms-wmv',
};

videoRouter.get('/api/video/stream', (req, res) => {
  const filePath = String(req.query.path ?? '');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return void res.status(404).json({ error: 'File not found' });
  }
  const type = MIME[sourceExtension(filePath).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m || (m[1] === '' && m[2] === '')) return void res.status(416).end();
  const start = m[1] === '' ? 0 : Number(m[1]);
  const end = m[2] === '' ? stat.size - 1 : Math.min(Number(m[2]), stat.size - 1);
  if (start > end || start >= stat.size) return void res.status(416).end();

  res.writeHead(206, {
    'Content-Type': type,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/video-stream.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/video.ts tests/server/video-stream.test.ts
git commit -m "feat: range-capable video streaming endpoint"
```

---

### Task 8: `POST /api/export` — lossless segment export with progress

**Files:**
- Create: `server/export.ts`
- Modify: `server/app.ts` (mount router)
- Test: `tests/server/export.test.ts`

**Interfaces:**
- Consumes: `getVideoInfo`, `ffprobeJson` (Task 6); `normalizeSplits` (Task 3); `clipFileName`, `segmentPattern`, `defaultPrefix`, `sourceExtension`, `sanitizePrefix` (Task 4); `ensureFixture` (Task 6).
- Produces:
  - `interface ClipResult { fileName: string; start: number; end: number; duration: number }` — start/end are the actual keyframe-snapped times, derived from ffprobe durations of the output files.
  - `interface ExportJob { id: string; status: 'running' | 'done' | 'error'; percent: number; error?: string; stderrTail?: string; results?: ClipResult[]; mergedCuts?: number }`
  - `checkConflicts(outputDir: string, count: number, prefix: string, ext: string): string[]`
  - `getJob(id: string): ExportJob | undefined`
  - `exportRouter: express.Router` mounting:
    - `POST /api/export` — body `{ sourcePath, splitTimes, outputDir, prefix, overwrite }` → `200 { jobId }`, `400 { error }` on invalid input, `409 { conflicts: string[] }` when target files exist and `overwrite` is false.
    - `GET /api/export/:id` — the `ExportJob` JSON (`404 { error }` if unknown).
  - The frontend (Task 11) mirrors `ClipResult`/`ExportJob` types and polls `GET /api/export/:id` every 500ms.

- [ ] **Step 1: Write the failing tests**

Create `tests/server/export.test.ts`:

```ts
import { beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../server/app';
import { ensureFixture } from '../helpers/fixture';

let fixture: string;
const app: Express = createApp();

beforeAll(async () => {
  fixture = await ensureFixture();
});

function tmpOutDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'video-clipper-test-'));
}

async function waitForJob(id: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await request(app).get(`/api/export/${id}`);
    expect(res.status).toBe(200);
    if (res.body.status !== 'running') return res.body;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('export job did not finish within 30s');
}

describe('POST /api/export', () => {
  test('splits losslessly; clip durations sum to the source duration', async () => {
    const outDir = tmpOutDir();
    const res = await request(app).post('/api/export').send({
      sourcePath: fixture,
      splitTimes: [3, 6],
      outputDir: outDir,
      prefix: 'clip',
      overwrite: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.jobId).toBeTruthy();

    const job = await waitForJob(res.body.jobId);
    expect(job.status).toBe('done');
    expect(job.percent).toBe(100);
    expect(job.results).toHaveLength(3);
    expect(job.results[0].fileName).toBe('01 - clip.mp4');
    expect(job.results[1].fileName).toBe('02 - clip.mp4');
    expect(job.results[2].fileName).toBe('03 - clip.mp4');

    for (const r of job.results) {
      expect(fs.existsSync(path.join(outDir, r.fileName))).toBe(true);
    }
    const total = job.results.reduce((s: number, r: any) => s + r.duration, 0);
    expect(total).toBeGreaterThan(9.5);
    expect(total).toBeLessThan(10.5);
    // start/end chain contiguously from 0
    expect(job.results[0].start).toBe(0);
    expect(job.results[1].start).toBeCloseTo(job.results[0].end, 5);
    expect(job.results[2].start).toBeCloseTo(job.results[1].end, 5);
  });

  test('reports merged cuts when two splits snap to the same keyframe', async () => {
    // Keyframes are at whole seconds; 3.2 and 3.4 both snap to the keyframe at 4.
    const outDir = tmpOutDir();
    const res = await request(app).post('/api/export').send({
      sourcePath: fixture,
      splitTimes: [3.2, 3.4],
      outputDir: outDir,
      prefix: 'clip',
      overwrite: false,
    });
    expect(res.status).toBe(200);
    const job = await waitForJob(res.body.jobId);
    expect(job.status).toBe('done');
    expect(job.results.length + job.mergedCuts).toBe(3);
    const total = job.results.reduce((s: number, r: any) => s + r.duration, 0);
    expect(total).toBeGreaterThan(9.5);
    expect(total).toBeLessThan(10.5);
  });

  test('409 with conflict list when target files exist and overwrite is false', async () => {
    const outDir = tmpOutDir();
    fs.writeFileSync(path.join(outDir, '01 - clip.mp4'), 'existing');
    const res = await request(app).post('/api/export').send({
      sourcePath: fixture,
      splitTimes: [5],
      outputDir: outDir,
      prefix: 'clip',
      overwrite: false,
    });
    expect(res.status).toBe(409);
    expect(res.body.conflicts).toEqual(['01 - clip.mp4']);
  });

  test('proceeds over existing files when overwrite is true', async () => {
    const outDir = tmpOutDir();
    fs.writeFileSync(path.join(outDir, '01 - clip.mp4'), 'existing');
    const res = await request(app).post('/api/export').send({
      sourcePath: fixture,
      splitTimes: [5],
      outputDir: outDir,
      prefix: 'clip',
      overwrite: true,
    });
    expect(res.status).toBe(200);
    const job = await waitForJob(res.body.jobId);
    expect(job.status).toBe('done');
    expect(job.results).toHaveLength(2);
  });

  test('400 for split times outside the video duration', async () => {
    const res = await request(app).post('/api/export').send({
      sourcePath: fixture,
      splitTimes: [999],
      outputDir: tmpOutDir(),
      prefix: 'clip',
      overwrite: false,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inside the video/i);
  });

  test('400 for a non-existent source path', async () => {
    const res = await request(app).post('/api/export').send({
      sourcePath: '/nope/missing.mp4',
      splitTimes: [5],
      outputDir: tmpOutDir(),
      prefix: 'clip',
      overwrite: false,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/source/i);
  });

  test('400 for a non-existent output folder', async () => {
    const res = await request(app).post('/api/export').send({
      sourcePath: fixture,
      splitTimes: [5],
      outputDir: '/nope/missing-dir',
      prefix: 'clip',
      overwrite: false,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/output folder/i);
  });

  test('400 when no valid split points remain', async () => {
    const res = await request(app).post('/api/export').send({
      sourcePath: fixture,
      splitTimes: [],
      outputDir: tmpOutDir(),
      prefix: 'clip',
      overwrite: false,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/split point/i);
  });

  test('404 for an unknown job id', async () => {
    const res = await request(app).get('/api/export/does-not-exist');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/export.test.ts`
Expected: FAIL — `POST /api/export` returns 404 (route missing).

- [ ] **Step 3: Create `server/export.ts`**

```ts
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import ffmpegPath from 'ffmpeg-static';
import { normalizeSplits } from '../shared/segments';
import {
  clipFileName,
  defaultPrefix,
  sanitizePrefix,
  segmentPattern,
  sourceExtension,
} from '../shared/naming';
import { ffprobeJson, getVideoInfo } from './video';

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
}

const jobs = new Map<string, ExportJob>();

export function getJob(id: string): ExportJob | undefined {
  return jobs.get(id);
}

export function checkConflicts(outputDir: string, count: number, prefix: string, ext: string): string[] {
  const conflicts: string[] = [];
  for (let i = 1; i <= count; i++) {
    const name = clipFileName(i, count, prefix, ext);
    if (fs.existsSync(path.join(outputDir, name))) conflicts.push(name);
  }
  return conflicts;
}

interface StartOptions {
  sourcePath: string;
  splits: number[];
  outputDir: string;
  prefix: string;
  ext: string;
  durationSec: number;
}

function startExport(opts: StartOptions): string {
  const id = randomUUID();
  const job: ExportJob = { id, status: 'running', percent: 0 };
  jobs.set(id, job);

  const count = opts.splits.length + 1;
  const pattern = path.join(opts.outputDir, segmentPattern(count, opts.prefix, opts.ext));
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i', opts.sourcePath,
    '-c', 'copy',
    '-map', '0',
    '-f', 'segment',
    '-segment_times', opts.splits.join(','),
    '-reset_timestamps', '1',
    '-segment_start_number', '1',
    '-progress', 'pipe:1',
    pattern,
  ];

  const proc = spawn(ffmpegPath!, args);
  let stderrTail = '';
  proc.stderr.on('data', (d) => {
    stderrTail = (stderrTail + d).slice(-4000);
  });
  proc.stdout.on('data', (d) => {
    for (const line of String(d).split('\n')) {
      const m = /^out_time_us=(\d+)/.exec(line.trim());
      if (m) {
        job.percent = Math.min(99, (Number(m[1]) / 1e6 / opts.durationSec) * 100);
      }
    }
  });
  proc.on('error', (err) => {
    job.status = 'error';
    job.error = `Failed to start ffmpeg: ${err.message}`;
  });
  proc.on('close', async (code) => {
    if (job.status === 'error') return;
    if (code !== 0) {
      job.status = 'error';
      job.error = `ffmpeg exited with code ${code}`;
      job.stderrTail = stderrTail;
      return;
    }
    try {
      const { results, mergedCuts } = await collectResults(opts.outputDir, count, opts.prefix, opts.ext);
      job.results = results;
      job.mergedCuts = mergedCuts;
      job.percent = 100;
      job.status = 'done';
    } catch (err) {
      job.status = 'error';
      job.error = (err as Error).message;
      job.stderrTail = stderrTail;
    }
  });

  return id;
}

// Reads back each output file with ffprobe; actual (keyframe-snapped) start/end
// times are the cumulative durations. Zero-length leftovers from splits that
// snapped to the same keyframe are deleted and counted as merged cuts.
async function collectResults(outputDir: string, count: number, prefix: string, ext: string) {
  const results: ClipResult[] = [];
  let cursor = 0;
  for (let i = 1; i <= count; i++) {
    const name = clipFileName(i, count, prefix, ext);
    const full = path.join(outputDir, name);
    if (!fs.existsSync(full)) continue;
    const probe = await ffprobeJson(full);
    const duration = Number(probe.format?.duration ?? 0);
    if (duration < 0.05) {
      fs.unlinkSync(full);
      continue;
    }
    results.push({ fileName: name, start: cursor, end: cursor + duration, duration });
    cursor += duration;
  }
  return { results, mergedCuts: count - results.length };
}

export const exportRouter = Router();

exportRouter.post('/api/export', async (req, res) => {
  const body = req.body ?? {};
  const { sourcePath, splitTimes, outputDir, overwrite } = body;

  if (typeof sourcePath !== 'string' || !fs.existsSync(sourcePath)) {
    return void res.status(400).json({ error: 'Source video not found' });
  }
  if (
    typeof outputDir !== 'string' ||
    !fs.existsSync(outputDir) ||
    !fs.statSync(outputDir).isDirectory()
  ) {
    return void res.status(400).json({ error: 'Output folder not found' });
  }
  if (!Array.isArray(splitTimes) || splitTimes.some((t) => typeof t !== 'number' || !Number.isFinite(t))) {
    return void res.status(400).json({ error: 'splitTimes must be an array of numbers' });
  }

  try {
    const info = await getVideoInfo(sourcePath);
    if (splitTimes.some((t) => t <= 0 || t >= info.durationSec)) {
      return void res.status(400).json({ error: 'All split times must be inside the video duration' });
    }
    const splits = normalizeSplits(splitTimes, info.durationSec);
    if (splits.length === 0) {
      return void res.status(400).json({ error: 'At least one split point is required' });
    }
    const prefix = sanitizePrefix(
      typeof body.prefix === 'string' && body.prefix.trim() !== ''
        ? body.prefix
        : defaultPrefix(path.basename(sourcePath)),
    );
    const ext = sourceExtension(sourcePath);
    const count = splits.length + 1;

    const conflicts = checkConflicts(outputDir, count, prefix, ext);
    if (conflicts.length > 0 && overwrite !== true) {
      return void res.status(409).json({ conflicts });
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
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

exportRouter.get('/api/export/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return void res.status(404).json({ error: 'Job not found' });
  res.json(job);
});
```

- [ ] **Step 4: Mount the router in `server/app.ts`**

Add `import { exportRouter } from './export';` and `app.use(exportRouter);` directly after `app.use(videoRouter);`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/server/export.test.ts`
Expected: PASS (all 9 tests; the suite spawns real ffmpeg several times, ~10–20s).

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS — every test from Tasks 1–8.

- [ ] **Step 7: Commit**

```bash
git add server/export.ts server/app.ts tests/server/export.test.ts
git commit -m "feat: lossless segment export with progress and conflict handling"
```

---

### Task 9: Frontend — pick video, player, info bar

**Files:**
- Create: `web/src/lib/api.ts`
- Modify: `web/src/App.tsx` (full replacement below)
- Modify: `web/src/styles.css` (append)

**Interfaces:**
- Consumes: server endpoints from Tasks 5–7; `formatTimestamp` from `shared/time`.
- Produces:
  - `web/src/lib/api.ts` exporting `interface VideoInfo` (identical shape to the server's), `pickFile(): Promise<string | null>`, `pickFolder(): Promise<string | null>`, `fetchVideoInfo(path: string): Promise<VideoInfo>`, `streamUrl(path: string): string`. Task 11 appends export functions to this file.
  - `App` holds `video: VideoInfo | null` and `videoRef: RefObject<HTMLVideoElement | null>` — Task 10 builds split state on top of these.

- [ ] **Step 1: Create `web/src/lib/api.ts`**

```ts
export interface VideoInfo {
  path: string;
  fileName: string;
  durationSec: number;
  container: string;
  videoCodec: string;
  audioCodec: string | null;
  width: number;
  height: number;
  previewable: boolean;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function post(url: string): Promise<any> {
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(await readError(res, `Request failed (${res.status})`));
  return res.json();
}

export async function pickFile(): Promise<string | null> {
  return (await post('/api/dialog/file')).path;
}

export async function pickFolder(): Promise<string | null> {
  return (await post('/api/dialog/folder')).path;
}

export async function fetchVideoInfo(path: string): Promise<VideoInfo> {
  const res = await fetch(`/api/video/info?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(await readError(res, 'Failed to read video info'));
  return res.json();
}

export function streamUrl(path: string): string {
  return `/api/video/stream?path=${encodeURIComponent(path)}`;
}
```

- [ ] **Step 2: Replace `web/src/App.tsx`**

```tsx
import { useRef, useState } from 'react';
import { fetchVideoInfo, pickFile, streamUrl, type VideoInfo } from './lib/api';
import { formatTimestamp } from '../../shared/time';

export default function App() {
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  async function chooseVideo() {
    setError(null);
    try {
      const path = await pickFile();
      if (path === null) return; // user cancelled
      setVideo(await fetchVideoInfo(path));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main>
      <h1>Video Clipper</h1>
      <button onClick={chooseVideo}>{video ? 'Choose another video…' : 'Choose video…'}</button>
      {error && <p className="error">{error}</p>}
      {video && (
        <>
          <p className="video-info">
            <strong>{video.fileName}</strong> — {formatTimestamp(video.durationSec)} ·{' '}
            {video.width}×{video.height} · {video.videoCodec} · {video.container}
          </p>
          {!video.previewable && (
            <p className="notice">
              This format may not preview in the browser. You can still add split times
              manually below and export losslessly.
            </p>
          )}
          <video ref={videoRef} src={streamUrl(video.path)} controls className="player" />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Append to `web/src/styles.css`**

```css
.player {
  width: 100%;
  max-height: 60vh;
  background: #000;
  border-radius: 6px;
}
.video-info {
  margin: 0.75rem 0 0.25rem;
}
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0.

- [ ] **Step 5: Manual verification**

Run: `npm start`. In the opened page: click "Choose video…", pick any real video (e.g. an mp4). Expected: filename, duration, resolution, codec appear; the player loads and scrubbing works. Cancelling the dialog leaves the page unchanged. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat: video picking, playback, and info display"
```

---

### Task 10: Frontend — split marking (button, S key, editable list, timeline)

**Files:**
- Create: `web/src/components/SplitEditor.tsx`, `web/src/components/Timeline.tsx`
- Modify: `web/src/App.tsx` (full replacement below)
- Modify: `web/src/styles.css` (append)

**Interfaces:**
- Consumes: `normalizeSplits`, `computeSegments` from `shared/segments`; `parseTimestamp`, `formatTimestamp` from `shared/time`; Task 9's `App` state.
- Produces:
  - `SplitEditor({ splits, duration, onChange }: { splits: number[]; duration: number; onChange: (next: number[]) => void })` — editable timestamp list; `onChange` receives the raw next array and the parent normalizes it.
  - `Timeline({ duration, splits, onRemoveSplit, onSeek }: { duration: number; splits: number[]; onRemoveSplit: (t: number) => void; onSeek: (t: number) => void })`
  - `App` holds `splits: number[]` (always normalized) — Task 11 passes `video` and `splits` into `ExportPanel`.

- [ ] **Step 1: Create `web/src/components/SplitEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { formatTimestamp, parseTimestamp } from '../../../shared/time';

const HINT = 'Enter a time inside the video, e.g. 00:12:34';

interface RowProps {
  value: number;
  duration: number;
  onCommit: (t: number) => void;
  onRemove: () => void;
}

function SplitRow({ value, duration, onCommit, onRemove }: RowProps) {
  const [text, setText] = useState(formatTimestamp(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(formatTimestamp(value));
    setInvalid(false);
  }, [value]);

  function commit() {
    const t = parseTimestamp(text);
    if (t === null || t <= 0 || t >= duration) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (t !== value) onCommit(t);
  }

  return (
    <li>
      <input
        value={text}
        className={invalid ? 'invalid' : ''}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <button onClick={onRemove} title="Delete this split">
        ✕
      </button>
      {invalid && <span className="error">{HINT}</span>}
    </li>
  );
}

interface SplitEditorProps {
  splits: number[];
  duration: number;
  onChange: (next: number[]) => void;
}

export function SplitEditor({ splits, duration, onChange }: SplitEditorProps) {
  const [newText, setNewText] = useState('');
  const [invalid, setInvalid] = useState(false);

  function add() {
    if (newText.trim() === '') return;
    const t = parseTimestamp(newText);
    if (t === null || t <= 0 || t >= duration) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setNewText('');
    onChange([...splits, t]);
  }

  return (
    <section>
      <h2>Split points</h2>
      {splits.length === 0 && <p>No splits yet — press “Split here” (or S) while playing, or type a timestamp.</p>}
      <ul className="split-list">
        {splits.map((t) => (
          <SplitRow
            key={t}
            value={t}
            duration={duration}
            onCommit={(next) => onChange([...splits.filter((x) => x !== t), next])}
            onRemove={() => onChange(splits.filter((x) => x !== t))}
          />
        ))}
      </ul>
      <div className="split-add">
        <input
          placeholder="hh:mm:ss"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button onClick={add}>Add split</button>
        {invalid && <span className="error">{HINT}</span>}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create `web/src/components/Timeline.tsx`**

```tsx
import { computeSegments } from '../../../shared/segments';
import { formatTimestamp } from '../../../shared/time';

interface TimelineProps {
  duration: number;
  splits: number[];
  onRemoveSplit: (t: number) => void;
  onSeek: (t: number) => void;
}

export function Timeline({ duration, splits, onRemoveSplit, onSeek }: TimelineProps) {
  const segments = computeSegments(splits, duration);
  return (
    <div className="timeline">
      {segments.map((seg) => (
        <div
          key={seg.index}
          className="segment"
          style={{ width: `${(seg.duration / duration) * 100}%` }}
          onClick={() => onSeek(seg.start)}
          title={`Clip ${seg.index}: ${formatTimestamp(seg.start)} → ${formatTimestamp(seg.end)} (click to seek)`}
        >
          <span className="segment-label">Clip {seg.index}</span>
          <span className="segment-duration">{formatTimestamp(seg.duration)}</span>
        </div>
      ))}
      {splits.map((t) => (
        <button
          key={t}
          className="split-marker"
          style={{ left: `${(t / duration) * 100}%` }}
          onClick={() => onRemoveSplit(t)}
          title={`Delete split at ${formatTimestamp(t)}`}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Replace `web/src/App.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchVideoInfo, pickFile, streamUrl, type VideoInfo } from './lib/api';
import { formatTimestamp } from '../../shared/time';
import { normalizeSplits } from '../../shared/segments';
import { SplitEditor } from './components/SplitEditor';
import { Timeline } from './components/Timeline';

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
      if (e.key.toLowerCase() !== 's' || e.metaKey || e.ctrlKey || e.altKey) return;
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
      <h1>Video Clipper</h1>
      <button onClick={chooseVideo}>{video ? 'Choose another video…' : 'Choose video…'}</button>
      {error && <p className="error">{error}</p>}
      {video && (
        <>
          <p className="video-info">
            <strong>{video.fileName}</strong> — {formatTimestamp(video.durationSec)} ·{' '}
            {video.width}×{video.height} · {video.videoCodec} · {video.container}
          </p>
          {!video.previewable && (
            <p className="notice">
              This format may not preview in the browser. You can still add split times
              manually below and export losslessly.
            </p>
          )}
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
          <SplitEditor splits={splits} duration={video.durationSec} onChange={setNormalizedSplits} />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Append to `web/src/styles.css`**

```css
.split-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0.5rem 0;
}
.timeline {
  position: relative;
  display: flex;
  height: 48px;
  margin: 0.75rem 0;
  border-radius: 6px;
  overflow: hidden;
  background: rgba(127, 127, 127, 0.15);
}
.segment {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-width: 0;
  cursor: pointer;
  border-right: 2px solid transparent;
  background: rgba(64, 128, 255, 0.25);
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
}
.segment:nth-child(even) {
  background: rgba(64, 128, 255, 0.4);
}
.segment:hover {
  background: rgba(64, 128, 255, 0.6);
}
.split-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  margin-left: -4px;
  padding: 0;
  border: none;
  background: #e74c3c;
  cursor: pointer;
}
.split-marker:hover {
  background: #ff6b5b;
}
.split-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.split-list li,
.split-add {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
input.invalid {
  outline: 2px solid #c0392b;
}
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0.

- [ ] **Step 6: Manual verification**

Run: `npm start`, pick a video, then verify each of:
1. "Split here (S)" adds a split at the player position; pressing `S` does the same (but not while typing in an input).
2. The timeline shows Clip 1, Clip 2, … blocks with durations; widths are proportional.
3. Clicking a red marker deletes that split; clicking a segment seeks the player to its start.
4. Editing a timestamp in the list moves the split (timeline updates); a malformed or out-of-range value shows the inline error and does not change state.
5. Adding a timestamp via the "Add split" row works; duplicates collapse to one.
Stop the server.

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "feat: split marking via button, S key, timestamp list, and timeline"
```

---

### Task 11: Frontend — export flow (folder, prefix, overwrite, progress, results)

**Files:**
- Create: `web/src/components/ExportPanel.tsx`
- Modify: `web/src/lib/api.ts` (append export API)
- Modify: `web/src/App.tsx` (render panel)
- Modify: `web/src/styles.css` (append)

**Interfaces:**
- Consumes: `POST /api/export` / `GET /api/export/:id` (Task 8); `pickFolder` (Task 9); `defaultPrefix` (Task 4); `formatTimestamp` (Task 2); `video` + `splits` from `App` (Tasks 9–10).
- Produces: `ExportPanel({ video, splits }: { video: VideoInfo; splits: number[] })` — the final section of the single screen.

- [ ] **Step 1: Append to `web/src/lib/api.ts`**

```ts
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
}

export interface ExportRequest {
  sourcePath: string;
  splitTimes: number[];
  outputDir: string;
  prefix: string;
  overwrite: boolean;
}

export async function startExport(
  req: ExportRequest,
): Promise<{ jobId?: string; conflicts?: string[] }> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (res.status === 409) return { conflicts: (await res.json()).conflicts };
  if (!res.ok) throw new Error(await readError(res, 'Export failed to start'));
  return res.json();
}

export async function getExportJob(id: string): Promise<ExportJob> {
  const res = await fetch(`/api/export/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(await readError(res, 'Export job not found'));
  return res.json();
}
```

- [ ] **Step 2: Create `web/src/components/ExportPanel.tsx`**

```tsx
import { useEffect, useState } from 'react';
import {
  getExportJob,
  pickFolder,
  startExport,
  type ExportJob,
  type VideoInfo,
} from '../lib/api';
import { defaultPrefix } from '../../../shared/naming';
import { formatTimestamp } from '../../../shared/time';

interface ExportPanelProps {
  video: VideoInfo;
  splits: number[];
}

export function ExportPanel({ video, splits }: ExportPanelProps) {
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [prefix, setPrefix] = useState(defaultPrefix(video.fileName));
  const [job, setJob] = useState<ExportJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPrefix(defaultPrefix(video.fileName));
    setJob(null);
    setError(null);
  }, [video.path, video.fileName]);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const timer = setInterval(async () => {
      try {
        setJob(await getExportJob(job.id));
      } catch {
        // transient poll failure — keep polling
      }
    }, 500);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);

  async function chooseFolder() {
    setError(null);
    try {
      const dir = await pickFolder();
      if (dir !== null) setOutputDir(dir);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function doExport(overwrite: boolean) {
    if (!outputDir) return;
    setError(null);
    try {
      const res = await startExport({
        sourcePath: video.path,
        splitTimes: splits,
        outputDir,
        prefix,
        overwrite,
      });
      if (res.conflicts) {
        const ok = window.confirm(
          `These files already exist in the output folder:\n\n${res.conflicts.join('\n')}\n\nOverwrite them?`,
        );
        if (ok) await doExport(true);
        return;
      }
      setJob({ id: res.jobId!, status: 'running', percent: 0 });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const canExport = splits.length > 0 && outputDir !== null && job?.status !== 'running';

  return (
    <section>
      <h2>Output</h2>
      <div className="output-row">
        <button onClick={chooseFolder}>Choose output folder…</button>
        <span className={outputDir ? '' : 'muted'}>{outputDir ?? 'No folder selected'}</span>
      </div>
      <div className="output-row">
        <label>
          Clip name prefix{' '}
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </label>
      </div>
      <button className="export-button" disabled={!canExport} onClick={() => doExport(false)}>
        Export {splits.length + 1} clips
      </button>
      {splits.length === 0 && <p className="notice">Add at least one split point to export.</p>}
      {error && <p className="error">{error}</p>}
      {job?.status === 'running' && (
        <div className="progress">
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${job.percent}%` }} />
          </div>
          <span>{Math.round(job.percent)}%</span>
        </div>
      )}
      {job?.status === 'error' && (
        <div className="error">
          <p>Export failed: {job.error}</p>
          {job.stderrTail && <pre className="stderr">{job.stderrTail}</pre>}
        </div>
      )}
      {job?.status === 'done' && job.results && (
        <div className="results">
          <p>Done — {job.results.length} clips written.</p>
          {job.mergedCuts ? (
            <p className="notice">
              {job.mergedCuts} split point(s) snapped to the same keyframe as a neighbour
              and were merged into a single cut.
            </p>
          ) : null}
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Start</th>
                <th>End</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {job.results.map((r) => (
                <tr key={r.fileName}>
                  <td>{r.fileName}</td>
                  <td>{formatTimestamp(r.start)}</td>
                  <td>{formatTimestamp(r.end)}</td>
                  <td>{formatTimestamp(r.duration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Render the panel in `web/src/App.tsx`**

Add the import:

```tsx
import { ExportPanel } from './components/ExportPanel';
```

and directly after the `<SplitEditor … />` line (still inside the `{video && (…)}` block) add:

```tsx
          <ExportPanel video={video} splits={splits} />
```

- [ ] **Step 4: Append to `web/src/styles.css`**

```css
.output-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0.5rem 0;
}
.muted {
  opacity: 0.6;
}
.export-button {
  font-size: 1.05rem;
  padding: 0.5rem 1.25rem;
  margin: 0.5rem 0;
}
.progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.progress-track {
  flex: 1;
  height: 10px;
  border-radius: 5px;
  background: rgba(127, 127, 127, 0.25);
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  background: #2ecc71;
  transition: width 0.3s;
}
.stderr {
  max-height: 12rem;
  overflow: auto;
  font-size: 0.75rem;
  background: rgba(127, 127, 127, 0.1);
  padding: 0.5rem;
  border-radius: 6px;
  white-space: pre-wrap;
}
.results table {
  border-collapse: collapse;
  margin-top: 0.5rem;
}
.results th,
.results td {
  text-align: left;
  padding: 0.25rem 1rem 0.25rem 0;
  border-bottom: 1px solid rgba(127, 127, 127, 0.25);
}
```

- [ ] **Step 5: Typecheck, build, run all tests**

Run: `npm run typecheck && npm run build && npm test`
Expected: all exit 0, every test passes.

- [ ] **Step 6: Manual verification**

Run: `npm start`, pick a video, add 2+ splits, then verify each of:
1. "Choose output folder…" opens the native folder picker and shows the chosen path.
2. The prefix defaults to the source filename (without extension) and is editable.
3. Export is disabled until a folder is chosen and at least one split exists.
4. Clicking Export shows a progress bar, then a results table with file names and snapped start/end/duration; the files exist in the folder and sort in timeline order.
5. Exporting again to the same folder triggers the overwrite confirm; cancelling aborts, accepting overwrites.
Stop the server.

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "feat: export flow with progress, results, and overwrite confirmation"
```

---

### Task 12: README + final verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything.
- Produces: user-facing docs; a fully verified build.

- [ ] **Step 1: Create `README.md`**

```markdown
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
```

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm run build && npm test`
Expected: all pass.

- [ ] **Step 3: Manual end-to-end check with a real long video (macOS)**

Run `npm start` and go through the full flow from the spec with a real, long video: pick → scrub → `S` a few times → edit one timestamp by hand → choose folder → export → confirm the clips play, sort in order, and their sizes sum to roughly the source size. Verify export works for a non-previewable file too if one is available (e.g. an MKV): the notice appears and timestamp-list splitting + export still work.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```
