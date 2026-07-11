export type SchedulerPlatform = 'tiktok';

export type PostStatus = 'scheduled' | 'uploading' | 'posted' | 'failed' | 'cancelled';

export type TikTokPrivacy =
  | 'SELF_ONLY'
  | 'PUBLIC_TO_EVERYONE'
  | 'MUTUAL_FOLLOW_FRIENDS'
  | 'FOLLOWER_OF_CREATOR';

export interface ScheduledPost {
  id: string;
  platform: SchedulerPlatform;
  videoPath: string;
  fileName: string;
  caption: string;
  privacy: TikTokPrivacy;
  /** Epoch milliseconds at which the post should publish. */
  publishAt: number;
  status: PostStatus;
  error?: string;
  createdAt: number;
}

/** What the client is allowed to see of the stored settings. */
export interface SchedulerSettingsView {
  hasAccessToken: boolean;
  /** Last 4 characters of the token, empty when none is set. */
  tokenPreview: string;
}

export interface SchedulerStateView {
  settings: SchedulerSettingsView;
  posts: ScheduledPost[];
}

export interface FolderVideo {
  path: string;
  fileName: string;
  sizeBytes: number;
  modifiedMs: number;
}

export interface ScheduleRequestVideo {
  path: string;
  caption: string;
}

export interface ScheduleRequest {
  videos: ScheduleRequestVideo[];
  /** Epoch milliseconds of the first post. */
  startAt: number;
  gapMinutes: number;
  privacy: TikTokPrivacy;
}

export const TIKTOK_PRIVACY_LEVELS: TikTokPrivacy[] = [
  'SELF_ONLY',
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
];

/** Publish timestamps for `count` queue positions, `gapMinutes` apart. */
export function computeScheduleTimes(startMs: number, gapMinutes: number, count: number): number[] {
  const gapMs = Math.max(0, gapMinutes) * 60_000;
  return Array.from({ length: count }, (_, i) => startMs + i * gapMs);
}
