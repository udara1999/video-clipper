import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import ffmpegPath from 'ffmpeg-static';
import { EPSILON, normalizeSplits } from '../shared/segments';
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
    // Invariant: a truly merged segment has zero frames (duration ~ 0), while any
    // real clip is at least one frame long — so the same EPSILON that separates
    // distinct split times safely identifies merged leftovers without ever
    // deleting a genuine ~1-frame clip.
    if (duration < EPSILON) {
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
