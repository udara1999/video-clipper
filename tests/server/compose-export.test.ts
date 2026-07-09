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
