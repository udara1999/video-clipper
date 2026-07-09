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
