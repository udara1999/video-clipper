import type {
  FolderVideo,
  ScheduledPost,
  ScheduleRequest,
  SchedulerSettingsView,
  SchedulerStateView,
} from '../../../shared/scheduler';

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function request(url: string, method: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    ...(body !== undefined && {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  if (!res.ok) throw new Error(await readError(res, `Request failed (${res.status})`));
  return res.json();
}

export async function fetchSchedulerState(): Promise<SchedulerStateView> {
  return request('/api/scheduler/state', 'GET');
}

export async function saveAccessToken(accessToken: string): Promise<SchedulerSettingsView> {
  return (await request('/api/scheduler/settings', 'PUT', { accessToken })).settings;
}

export interface CreatorInfo {
  nickname: string;
  username: string;
  privacyLevelOptions: string[];
}

export async function testConnection(): Promise<CreatorInfo> {
  return (await request('/api/scheduler/test', 'POST')).creator;
}

export async function listFolderVideos(dir: string): Promise<FolderVideo[]> {
  return (await request('/api/scheduler/videos', 'POST', { dir })).videos;
}

export async function createSchedule(req: ScheduleRequest): Promise<ScheduledPost[]> {
  return (await request('/api/scheduler/schedule', 'POST', req)).posts;
}

export async function cancelPost(id: string): Promise<ScheduledPost> {
  return (await request(`/api/scheduler/posts/${encodeURIComponent(id)}/cancel`, 'POST')).post;
}

export async function retryPost(id: string): Promise<ScheduledPost> {
  return (await request(`/api/scheduler/posts/${encodeURIComponent(id)}/retry`, 'POST')).post;
}

export async function removePost(id: string): Promise<void> {
  await request(`/api/scheduler/posts/${encodeURIComponent(id)}`, 'DELETE');
}
