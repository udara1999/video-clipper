import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Router } from 'express';
import { SchedulerStore } from './store';
import { queryCreatorInfo } from './tiktok';
import {
  computeScheduleTimes,
  TIKTOK_PRIVACY_LEVELS,
  type FolderVideo,
  type ScheduledPost,
  type TikTokPrivacy,
} from '../../shared/scheduler';

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.wmv', '.ts', '.mts',
]);

export function createSchedulerRouter(store: SchedulerStore): Router {
  const router = Router();

  router.get('/api/scheduler/state', (_req, res) => {
    res.json(store.stateView());
  });

  router.put('/api/scheduler/settings', (req, res) => {
    const token = req.body?.accessToken;
    if (typeof token !== 'string') {
      res.status(400).json({ error: 'accessToken must be a string' });
      return;
    }
    store.setAccessToken(token.trim());
    res.json({ settings: store.settingsView() });
  });

  router.post('/api/scheduler/test', async (_req, res) => {
    const token = store.getAccessToken();
    if (token === '') {
      res.status(400).json({ error: 'Save a TikTok access token first' });
      return;
    }
    try {
      res.json({ creator: await queryCreatorInfo(token) });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/api/scheduler/videos', async (req, res) => {
    const dir = req.body?.dir;
    if (typeof dir !== 'string' || dir === '') {
      res.status(400).json({ error: 'dir must be a non-empty string' });
      return;
    }
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const videos: FolderVideo[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
        const path = join(dir, entry.name);
        const info = await stat(path);
        videos.push({
          path,
          fileName: entry.name,
          sizeBytes: info.size,
          modifiedMs: info.mtimeMs,
        });
      }
      videos.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
      res.json({ videos });
    } catch (err) {
      res.status(400).json({ error: `Could not read folder: ${(err as Error).message}` });
    }
  });

  router.post('/api/scheduler/schedule', (req, res) => {
    const { videos, startAt, gapMinutes, privacy } = req.body ?? {};
    if (!Array.isArray(videos) || videos.length === 0) {
      res.status(400).json({ error: 'Select at least one video' });
      return;
    }
    if (typeof startAt !== 'number' || !Number.isFinite(startAt)) {
      res.status(400).json({ error: 'startAt must be an epoch-milliseconds number' });
      return;
    }
    if (typeof gapMinutes !== 'number' || !Number.isFinite(gapMinutes) || gapMinutes < 0) {
      res.status(400).json({ error: 'gapMinutes must be a non-negative number' });
      return;
    }
    if (!TIKTOK_PRIVACY_LEVELS.includes(privacy as TikTokPrivacy)) {
      res.status(400).json({ error: 'privacy is not a valid TikTok privacy level' });
      return;
    }
    for (const video of videos) {
      if (typeof video?.path !== 'string' || typeof video?.caption !== 'string') {
        res.status(400).json({ error: 'Each video needs a path and a caption' });
        return;
      }
      if (!existsSync(video.path)) {
        res.status(400).json({ error: `File not found: ${video.path}` });
        return;
      }
    }
    const times = computeScheduleTimes(startAt, gapMinutes, videos.length);
    const posts: ScheduledPost[] = videos.map((video: { path: string; caption: string }, i: number) => ({
      id: randomUUID(),
      platform: 'tiktok',
      videoPath: video.path,
      fileName: basename(video.path),
      caption: video.caption,
      privacy: privacy as TikTokPrivacy,
      publishAt: times[i],
      status: 'scheduled',
      createdAt: Date.now(),
    }));
    store.addPosts(posts);
    res.json({ posts });
  });

  router.post('/api/scheduler/posts/:id/cancel', (req, res) => {
    const post = store.getPosts().find((p) => p.id === req.params.id);
    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }
    if (post.status !== 'scheduled') {
      res.status(409).json({ error: `Only scheduled posts can be cancelled (status: ${post.status})` });
      return;
    }
    res.json({ post: store.updatePost(post.id, { status: 'cancelled' }) });
  });

  router.post('/api/scheduler/posts/:id/retry', (req, res) => {
    const post = store.getPosts().find((p) => p.id === req.params.id);
    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }
    if (post.status !== 'failed' && post.status !== 'cancelled') {
      res.status(409).json({ error: `Only failed or cancelled posts can be retried (status: ${post.status})` });
      return;
    }
    res.json({
      post: store.updatePost(post.id, {
        status: 'scheduled',
        publishAt: Date.now(),
        error: undefined,
      }),
    });
  });

  router.delete('/api/scheduler/posts/:id', (req, res) => {
    const post = store.getPosts().find((p) => p.id === req.params.id);
    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }
    if (post.status === 'uploading') {
      res.status(409).json({ error: 'Cannot remove a post while it is uploading' });
      return;
    }
    store.removePost(post.id);
    res.json({ ok: true });
  });

  return router;
}
