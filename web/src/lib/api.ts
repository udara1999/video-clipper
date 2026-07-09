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

export interface ClipResult {
  fileName: string;
  start: number;
  end: number;
  duration: number;
}

export interface ExportJob {
  id: string;
  status: 'running' | 'done' | 'error';
  percent: number;
  error?: string;
  stderrTail?: string;
  results?: ClipResult[];
  mergedCuts?: number;
}

export interface ExportRequest {
  sourcePath: string;
  splitTimes: number[];
  outputDir: string;
  prefix: string;
  overwrite: boolean;
}

export async function startExport(
  req: ExportRequest,
): Promise<{ jobId?: string; conflicts?: string[] }> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (res.status === 409) return { conflicts: (await res.json()).conflicts };
  if (!res.ok) throw new Error(await readError(res, 'Export failed to start'));
  return res.json();
}

export async function getExportJob(id: string): Promise<ExportJob> {
  const res = await fetch(`/api/export/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(await readError(res, 'Export job not found'));
  return res.json();
}
