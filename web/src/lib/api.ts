export interface VideoInfo {
  path: string;
  fileName: string;
  durationSec: number;
  container: string;
  videoCodec: string;
  audioCodec: string | null;
  width: number;
  height: number;
  previewable: boolean;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function post(url: string): Promise<any> {
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(await readError(res, `Request failed (${res.status})`));
  return res.json();
}

export async function pickFile(): Promise<string | null> {
  return (await post('/api/dialog/file')).path;
}

export async function pickFolder(): Promise<string | null> {
  return (await post('/api/dialog/folder')).path;
}

export async function fetchVideoInfo(path: string): Promise<VideoInfo> {
  const res = await fetch(`/api/video/info?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(await readError(res, 'Failed to read video info'));
  return res.json();
}

export function streamUrl(path: string): string {
  return `/api/video/stream?path=${encodeURIComponent(path)}`;
}
