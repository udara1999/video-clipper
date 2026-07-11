import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app';
import { SchedulerStore } from '../../server/scheduler/store';

let dir: string;
let store: SchedulerStore;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sched-router-'));
  store = new SchedulerStore(dir);
  app = createApp(store);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeVideos(...names: string[]): string {
  const videosDir = join(dir, 'videos');
  mkdirSync(videosDir, { recursive: true });
  for (const name of names) writeFileSync(join(videosDir, name), 'x');
  return videosDir;
}

test('state starts empty with masked settings', async () => {
  const res = await request(app).get('/api/scheduler/state');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    settings: { hasAccessToken: false, tokenPreview: '' },
    posts: [],
  });
});

test('saving a token never echoes it back', async () => {
  const res = await request(app)
    .put('/api/scheduler/settings')
    .send({ accessToken: 'act.supersecret9876' });
  expect(res.status).toBe(200);
  expect(res.body.settings).toEqual({ hasAccessToken: true, tokenPreview: '…9876' });
  expect(JSON.stringify(res.body)).not.toContain('supersecret');
});

test('settings rejects a non-string token', async () => {
  const res = await request(app).put('/api/scheduler/settings').send({ accessToken: 42 });
  expect(res.status).toBe(400);
});

test('folder listing returns only video files, sorted', async () => {
  const videosDir = makeVideos('b.mp4', 'a.MOV', 'notes.txt', 'c.webm');
  const res = await request(app).post('/api/scheduler/videos').send({ dir: videosDir });
  expect(res.status).toBe(200);
  expect(res.body.videos.map((v: { fileName: string }) => v.fileName)).toEqual([
    'a.MOV',
    'b.mp4',
    'c.webm',
  ]);
});

test('folder listing rejects a missing directory', async () => {
  const res = await request(app)
    .post('/api/scheduler/videos')
    .send({ dir: join(dir, 'nope') });
  expect(res.status).toBe(400);
});

test('scheduling creates posts spaced by the gap', async () => {
  const videosDir = makeVideos('a.mp4', 'b.mp4');
  const startAt = Date.now() + 60_000;
  const res = await request(app)
    .post('/api/scheduler/schedule')
    .send({
      videos: [
        { path: join(videosDir, 'a.mp4'), caption: 'first' },
        { path: join(videosDir, 'b.mp4'), caption: 'second' },
      ],
      startAt,
      gapMinutes: 30,
      privacy: 'SELF_ONLY',
    });
  expect(res.status).toBe(200);
  expect(res.body.posts).toHaveLength(2);
  expect(res.body.posts[0].publishAt).toBe(startAt);
  expect(res.body.posts[1].publishAt).toBe(startAt + 30 * 60_000);
  expect(store.getPosts()).toHaveLength(2);
});

test('scheduling validates inputs', async () => {
  const videosDir = makeVideos('a.mp4');
  const video = { path: join(videosDir, 'a.mp4'), caption: 'x' };
  const base = { videos: [video], startAt: Date.now(), gapMinutes: 10, privacy: 'SELF_ONLY' };

  const cases = [
    { ...base, videos: [] },
    { ...base, startAt: 'tomorrow' },
    { ...base, gapMinutes: -5 },
    { ...base, privacy: 'FRIENDS_ONLY' },
    { ...base, videos: [{ path: join(videosDir, 'missing.mp4'), caption: 'x' }] },
  ];
  for (const body of cases) {
    const res = await request(app).post('/api/scheduler/schedule').send(body);
    expect(res.status, JSON.stringify(body)).toBe(400);
  }
});

async function scheduleOne(): Promise<string> {
  const videosDir = makeVideos('a.mp4');
  const res = await request(app)
    .post('/api/scheduler/schedule')
    .send({
      videos: [{ path: join(videosDir, 'a.mp4'), caption: 'x' }],
      startAt: Date.now() + 3_600_000,
      gapMinutes: 0,
      privacy: 'SELF_ONLY',
    });
  return res.body.posts[0].id;
}

test('cancel, retry, and remove transition posts correctly', async () => {
  const id = await scheduleOne();

  const cancelled = await request(app).post(`/api/scheduler/posts/${id}/cancel`);
  expect(cancelled.status).toBe(200);
  expect(cancelled.body.post.status).toBe('cancelled');

  // cancelling again conflicts
  expect((await request(app).post(`/api/scheduler/posts/${id}/cancel`)).status).toBe(409);

  const retried = await request(app).post(`/api/scheduler/posts/${id}/retry`);
  expect(retried.status).toBe(200);
  expect(retried.body.post.status).toBe('scheduled');
  expect(retried.body.post.publishAt).toBeLessThanOrEqual(Date.now());

  expect((await request(app).delete(`/api/scheduler/posts/${id}`)).status).toBe(200);
  expect(store.getPosts()).toHaveLength(0);
});

test('post actions 404 on unknown ids', async () => {
  expect((await request(app).post('/api/scheduler/posts/nope/cancel')).status).toBe(404);
  expect((await request(app).post('/api/scheduler/posts/nope/retry')).status).toBe(404);
  expect((await request(app).delete('/api/scheduler/posts/nope')).status).toBe(404);
});

test('test connection requires a saved token', async () => {
  const res = await request(app).post('/api/scheduler/test');
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/token/i);
});
