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

  test('job errors with stderr tail when ffmpeg cannot write its output', async () => {
    // Read-only output dir: the request passes validation and the conflict
    // check (both only read), but ffmpeg fails to open the segment file.
    const outDir = tmpOutDir();
    fs.chmodSync(outDir, 0o555);
    try {
      const res = await request(app).post('/api/export').send({
        sourcePath: fixture,
        splitTimes: [5],
        outputDir: outDir,
        prefix: 'clip',
        overwrite: false,
      });
      expect(res.status).toBe(200);
      const job = await waitForJob(res.body.jobId);
      expect(job.status).toBe('error');
      expect(job.error).toMatch(/ffmpeg exited with code/i);
      expect(typeof job.stderrTail).toBe('string');
      expect(job.stderrTail.length).toBeGreaterThan(0);
    } finally {
      fs.chmodSync(outDir, 0o755);
    }
  });
});
