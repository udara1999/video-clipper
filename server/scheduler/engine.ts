import type { SchedulerStore } from './store';
import { directPost } from './tiktok';
import type { ScheduledPost } from '../../shared/scheduler';

export type Uploader = (token: string, post: ScheduledPost) => Promise<void>;

const defaultUploader: Uploader = async (token, post) => {
  await directPost(token, post.videoPath, {
    title: post.caption,
    privacyLevel: post.privacy,
  });
};

/**
 * Publishes due posts while the local server is running. Posts are processed
 * one at a time (TikTok rate-limits posting); a failing post is marked failed
 * and never blocks later ones.
 */
export class SchedulerEngine {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly store: SchedulerStore,
    private readonly uploader: Uploader = defaultUploader,
    private readonly now: () => number = Date.now,
  ) {}

  start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return; // a long upload can outlive the interval
    this.running = true;
    try {
      const due = this.store
        .getPosts()
        .filter((p) => p.status === 'scheduled' && p.publishAt <= this.now())
        .sort((a, b) => a.publishAt - b.publishAt);
      for (const post of due) {
        await this.publish(post);
      }
    } finally {
      this.running = false;
    }
  }

  private async publish(post: ScheduledPost): Promise<void> {
    const token = this.store.getAccessToken();
    if (token === '') {
      this.store.updatePost(post.id, {
        status: 'failed',
        error: 'No TikTok access token is configured',
      });
      return;
    }
    this.store.updatePost(post.id, { status: 'uploading', error: undefined });
    try {
      await this.uploader(token, post);
      this.store.updatePost(post.id, { status: 'posted' });
    } catch (err) {
      this.store.updatePost(post.id, { status: 'failed', error: (err as Error).message });
    }
  }
}
