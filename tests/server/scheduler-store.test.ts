import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { SchedulerStore } from '../../server/scheduler/store';
import type { ScheduledPost } from '../../shared/scheduler';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sched-store-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function post(overrides: Partial<ScheduledPost> = {}): ScheduledPost {
  return {
    id: 'p1',
    platform: 'tiktok',
    videoPath: '/tmp/a.mp4',
    fileName: 'a.mp4',
    caption: 'a',
    privacy: 'SELF_ONLY',
    publishAt: 1000,
    status: 'scheduled',
    createdAt: 1,
    ...overrides,
  };
}

test('persists settings and posts across instances', () => {
  const store = new SchedulerStore(dir);
  store.setAccessToken('act.secret1234');
  store.addPosts([post()]);

  const reloaded = new SchedulerStore(dir);
  expect(reloaded.getAccessToken()).toBe('act.secret1234');
  expect(reloaded.getPosts()).toHaveLength(1);
  expect(reloaded.getPosts()[0].fileName).toBe('a.mp4');
});

test('settings view masks the token', () => {
  const store = new SchedulerStore(dir);
  expect(store.settingsView()).toEqual({ hasAccessToken: false, tokenPreview: '' });
  store.setAccessToken('act.secret1234');
  expect(store.settingsView()).toEqual({ hasAccessToken: true, tokenPreview: '…1234' });
});

test('the state file is only readable by the owner', () => {
  const store = new SchedulerStore(dir);
  store.setAccessToken('secret');
  const mode = statSync(join(dir, 'scheduler.json')).mode & 0o777;
  expect(mode).toBe(0o600);
});

test('updatePost patches and returns the post; unknown ids return undefined', () => {
  const store = new SchedulerStore(dir);
  store.addPosts([post()]);
  const updated = store.updatePost('p1', { status: 'failed', error: 'boom' });
  expect(updated?.status).toBe('failed');
  expect(store.getPosts()[0].error).toBe('boom');
  expect(store.updatePost('nope', { status: 'posted' })).toBeUndefined();
});

test('removePost deletes and reports whether it existed', () => {
  const store = new SchedulerStore(dir);
  store.addPosts([post()]);
  expect(store.removePost('p1')).toBe(true);
  expect(store.getPosts()).toHaveLength(0);
  expect(store.removePost('p1')).toBe(false);
});

test('getPosts returns copies that do not mutate the store', () => {
  const store = new SchedulerStore(dir);
  store.addPosts([post()]);
  store.getPosts()[0].status = 'posted';
  expect(store.getPosts()[0].status).toBe('scheduled');
});

test('a corrupt state file falls back to empty state', () => {
  writeFileSync(join(dir, 'scheduler.json'), 'not json{');
  const store = new SchedulerStore(dir);
  expect(store.getPosts()).toEqual([]);
  expect(store.getAccessToken()).toBe('');
});
