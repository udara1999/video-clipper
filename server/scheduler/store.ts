import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  ScheduledPost,
  SchedulerSettingsView,
  SchedulerStateView,
} from '../../shared/scheduler';

interface SchedulerSettings {
  tiktokAccessToken: string;
}

interface PersistedState {
  settings: SchedulerSettings;
  posts: ScheduledPost[];
}

const EMPTY_STATE: PersistedState = {
  settings: { tiktokAccessToken: '' },
  posts: [],
};

export function defaultDataDir(): string {
  return process.env.VIDEO_CLIPPER_DATA_DIR ?? join(homedir(), '.video-clipper');
}

/**
 * JSON-file persistence for scheduler settings and the post queue. The file
 * holds the TikTok access token, so it is created with owner-only permissions
 * and the token never leaves the server (views expose a masked preview only).
 */
export class SchedulerStore {
  private state: PersistedState | null = null;
  private readonly filePath: string;

  constructor(private readonly dir: string = defaultDataDir()) {
    this.filePath = join(dir, 'scheduler.json');
  }

  private load(): PersistedState {
    if (this.state) return this.state;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      this.state = {
        settings: {
          tiktokAccessToken: typeof raw?.settings?.tiktokAccessToken === 'string'
            ? raw.settings.tiktokAccessToken
            : '',
        },
        posts: Array.isArray(raw?.posts) ? raw.posts : [],
      };
    } catch {
      this.state = structuredClone(EMPTY_STATE);
    }
    return this.state;
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.load(), null, 2), { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }

  getAccessToken(): string {
    return this.load().settings.tiktokAccessToken;
  }

  setAccessToken(token: string): void {
    this.load().settings.tiktokAccessToken = token;
    this.save();
  }

  settingsView(): SchedulerSettingsView {
    const token = this.getAccessToken();
    return {
      hasAccessToken: token !== '',
      tokenPreview: token === '' ? '' : `…${token.slice(-4)}`,
    };
  }

  stateView(): SchedulerStateView {
    return { settings: this.settingsView(), posts: this.getPosts() };
  }

  getPosts(): ScheduledPost[] {
    // Copy so callers can't mutate persisted state without going through save.
    return this.load().posts.map((p) => ({ ...p }));
  }

  addPosts(posts: ScheduledPost[]): void {
    this.load().posts.push(...posts);
    this.save();
  }

  updatePost(id: string, patch: Partial<ScheduledPost>): ScheduledPost | undefined {
    const post = this.load().posts.find((p) => p.id === id);
    if (!post) return undefined;
    Object.assign(post, patch);
    this.save();
    return { ...post };
  }

  removePost(id: string): boolean {
    const posts = this.load().posts;
    const idx = posts.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    posts.splice(idx, 1);
    this.save();
    return true;
  }
}
