import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import type { Placement } from '../shared/compose';
import { clampTextTiming } from '../shared/compose';
import { clipFileName } from '../shared/naming';
import { createJob, type ClipResult, type ExportJob } from './jobs';
import { ffprobeJson } from './video';

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
