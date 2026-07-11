import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SchedulerEngine } from '../../server/scheduler/engine';
import { SchedulerStore } from '../../server/scheduler/store';
import type { ScheduledPost } from '../../shared/scheduler';

let dir: string;
let store: SchedulerStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sched-engine-'));
  store = new SchedulerStore(dir);
  store.setAccessToken('token');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
function addPost(overrides: Partial<ScheduledPost> = {}): ScheduledPost {
  const post: ScheduledPost = {
    id: `p${++seq}`,
    platform: 'tiktok',
    videoPath: `/tmp/v${seq}.mp4`,
    fileName: `v${seq}.mp4`,
    caption: 'cap',
    privacy: 'SELF_ONLY',
    publishAt: 1000,
    status: 'scheduled',
    createdAt: 1,
    ...overrides,
  };
  store.addPosts([post]);
  return post;
}

test('publishes due posts oldest-first and marks them posted', async () => {
  const later = addPost({ publishAt: 900 });
  const earlier = addPost({ publishAt: 100 });
  addPost({ publishAt: 5000 }); // not yet due

  const uploaded: string[] = [];
  const engine = new SchedulerEngine(
    store,
    async (_token, post) => {
      uploaded.push(post.id);
    },
    () => 1000,
  );
  await engine.tick();

  expect(uploaded).toEqual([earlier.id, later.id]);
  const byId = new Map(store.getPosts().map((p) => [p.id, p.status]));
  expect(byId.get(earlier.id)).toBe('posted');
  expect(byId.get(later.id)).toBe('posted');
  expect([...byId.values()].filter((s) => s === 'scheduled')).toHaveLength(1);
});

test('a failing upload marks the post failed and later posts still publish', async () => {
  const bad = addPost({ publishAt: 100 });
  const good = addPost({ publishAt: 200 });

  const engine = new SchedulerEngine(
    store,
    async (_token, post) => {
      if (post.id === bad.id) throw new Error('network down');
    },
    () => 1000,
  );
  await engine.tick();

  const byId = new Map(store.getPosts().map((p) => [p.id, p]));
  expect(byId.get(bad.id)?.status).toBe('failed');
  expect(byId.get(bad.id)?.error).toBe('network down');
  expect(byId.get(good.id)?.status).toBe('posted');
});

test('posts fail immediately when no token is configured', async () => {
  store.setAccessToken('');
  const post = addPost({ publishAt: 100 });
  const uploader = vi.fn();
  const engine = new SchedulerEngine(store, uploader, () => 1000);
  await engine.tick();

  expect(uploader).not.toHaveBeenCalled();
  expect(store.getPosts()[0].error).toMatch(/access token/i);
  expect(store.getPosts()[0].status).toBe('failed');
  expect(post.id).toBeTruthy();
});

test('cancelled, posted, and uploading posts are never picked up', async () => {
  addPost({ publishAt: 100, status: 'cancelled' });
  addPost({ publishAt: 100, status: 'posted' });
  addPost({ publishAt: 100, status: 'uploading' });
  const uploader = vi.fn();
  const engine = new SchedulerEngine(store, uploader, () => 1000);
  await engine.tick();
  expect(uploader).not.toHaveBeenCalled();
});

test('overlapping ticks do not double-publish', async () => {
  addPost({ publishAt: 100 });
  let resolveUpload!: () => void;
  const uploader = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveUpload = resolve;
      }),
  );
  const engine = new SchedulerEngine(store, uploader, () => 1000);

  const first = engine.tick();
  const second = engine.tick(); // re-entrant: must be a no-op
  await second;
  resolveUpload();
  await first;

  expect(uploader).toHaveBeenCalledTimes(1);
  expect(store.getPosts()[0].status).toBe('posted');
});
