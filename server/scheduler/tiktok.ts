import { open, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import type { TikTokPrivacy } from '../../shared/scheduler';

// TikTok Content Posting API v2 (direct post via FILE_UPLOAD).
// https://developers.tiktok.com/doc/content-posting-api-reference-direct-post

function apiBase(): string {
  return process.env.TIKTOK_API_BASE_URL ?? 'https://open.tiktokapis.com';
}

const MB = 1024 * 1024;
// TikTok requires 5 MB <= chunk_size <= 64 MB, and merges trailing bytes into
// the final chunk. Videos at or under 64 MB must be sent as a single chunk.
const MIN_CHUNK = 5 * MB;
const MAX_WHOLE = 64 * MB;
const CHUNK_SIZE = 10 * MB;

export interface ChunkPlan {
  chunkSize: number;
  totalChunkCount: number;
  /** Byte ranges [start, endExclusive) per chunk. */
  ranges: Array<{ start: number; end: number }>;
}

export function planChunks(videoSize: number): ChunkPlan {
  if (videoSize <= 0) throw new Error('Video file is empty');
  if (videoSize <= MAX_WHOLE) {
    return {
      chunkSize: videoSize,
      totalChunkCount: 1,
      ranges: [{ start: 0, end: videoSize }],
    };
  }
  const totalChunkCount = Math.floor(videoSize / CHUNK_SIZE);
  const ranges = Array.from({ length: totalChunkCount }, (_, i) => ({
    start: i * CHUNK_SIZE,
    // The last chunk absorbs the remainder, per TikTok's upload rules.
    end: i === totalChunkCount - 1 ? videoSize : (i + 1) * CHUNK_SIZE,
  }));
  return { chunkSize: CHUNK_SIZE, totalChunkCount, ranges };
}

interface TikTokEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

async function callApi<T>(token: string, path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Could not reach TikTok API: ${(err as Error).message}`);
  }
  let envelope: TikTokEnvelope<T>;
  try {
    envelope = await res.json();
  } catch {
    throw new Error(`TikTok API returned an unreadable response (HTTP ${res.status})`);
  }
  const code = envelope.error?.code ?? 'ok';
  if (code !== 'ok') {
    throw new Error(`TikTok API error ${code}: ${envelope.error?.message ?? 'unknown error'}`);
  }
  if (!res.ok || !envelope.data) {
    throw new Error(`TikTok API request failed (HTTP ${res.status})`);
  }
  return envelope.data;
}

export interface CreatorInfo {
  nickname: string;
  username: string;
  privacyLevelOptions: string[];
}

export async function queryCreatorInfo(token: string): Promise<CreatorInfo> {
  const data = await callApi<{
    creator_nickname?: string;
    creator_username?: string;
    privacy_level_options?: string[];
  }>(token, '/v2/post/publish/creator_info/query/', {});
  return {
    nickname: data.creator_nickname ?? '',
    username: data.creator_username ?? '',
    privacyLevelOptions: data.privacy_level_options ?? [],
  };
}

const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

export interface DirectPostOptions {
  title: string;
  privacyLevel: TikTokPrivacy;
  /** Injected in tests to skip real waiting between status polls. */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface DirectPostResult {
  publishId: string;
}

async function uploadChunks(uploadUrl: string, filePath: string, size: number): Promise<void> {
  const mime = VIDEO_MIME[extname(filePath).toLowerCase()] ?? 'video/mp4';
  const plan = planChunks(size);
  const file = await open(filePath, 'r');
  try {
    for (const { start, end } of plan.ranges) {
      const buffer = Buffer.alloc(end - start);
      await file.read(buffer, 0, buffer.length, start);
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': mime,
          'Content-Range': `bytes ${start}-${end - 1}/${size}`,
        },
        body: new Uint8Array(buffer),
      });
      if (!res.ok) {
        throw new Error(`Chunk upload failed (HTTP ${res.status}) at bytes ${start}-${end - 1}`);
      }
    }
  } finally {
    await file.close();
  }
}

async function waitForPublish(
  token: string,
  publishId: string,
  intervalMs: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const data = await callApi<{ status?: string; fail_reason?: string }>(
      token,
      '/v2/post/publish/status/fetch/',
      { publish_id: publishId },
    );
    if (data.status === 'PUBLISH_COMPLETE' || data.status === 'SEND_TO_USER_INBOX') return;
    if (data.status === 'FAILED') {
      throw new Error(`TikTok rejected the post: ${data.fail_reason ?? 'unknown reason'}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for TikTok to process the post (${publishId})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Upload a local video file and publish it. Resolves once TikTok confirms. */
export async function directPost(
  token: string,
  filePath: string,
  opts: DirectPostOptions,
): Promise<DirectPostResult> {
  const { size } = await stat(filePath);
  const plan = planChunks(size);
  const init = await callApi<{ publish_id?: string; upload_url?: string }>(
    token,
    '/v2/post/publish/video/init/',
    {
      post_info: {
        title: opts.title,
        privacy_level: opts.privacyLevel,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.totalChunkCount,
      },
    },
  );
  if (!init.publish_id || !init.upload_url) {
    throw new Error('TikTok init response was missing publish_id or upload_url');
  }
  await uploadChunks(init.upload_url, filePath, size);
  await waitForPublish(
    token,
    init.publish_id,
    opts.pollIntervalMs ?? 5_000,
    opts.pollTimeoutMs ?? 10 * 60_000,
  );
  return { publishId: init.publish_id };
}
