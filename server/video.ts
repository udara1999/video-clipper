import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { Router } from 'express';
import ffprobeStatic from 'ffprobe-static';
import { sourceExtension } from '../shared/naming';

const execFileP = promisify(execFile);

export async function ffprobeJson(filePath: string): Promise<any> {
  const { stdout } = await execFileP(
    ffprobeStatic.path,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

export function isLikelyPreviewable(ext: string, videoCodec: string): boolean {
  const containerOk = ['mp4', 'm4v', 'mov', 'webm'].includes(ext.toLowerCase());
  const codecOk = ['h264', 'vp8', 'vp9', 'av1'].includes(videoCodec.toLowerCase());
  return containerOk && codecOk;
}

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

export async function getVideoInfo(filePath: string): Promise<VideoInfo> {
  const probe = await ffprobeJson(filePath);
  const streams: any[] = probe.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('No video stream found in file');
  const a = streams.find((s) => s.codec_type === 'audio');
  const ext = sourceExtension(filePath);
  return {
    path: filePath,
    fileName: path.basename(filePath),
    durationSec: Number(probe.format?.duration ?? 0),
    container: ext,
    videoCodec: v.codec_name ?? 'unknown',
    audioCodec: a?.codec_name ?? null,
    width: v.width ?? 0,
    height: v.height ?? 0,
    previewable: isLikelyPreviewable(ext, v.codec_name ?? ''),
  };
}

export const videoRouter = Router();

videoRouter.get('/api/video/info', async (req, res) => {
  const filePath = String(req.query.path ?? '');
  if (filePath === '' || !fs.existsSync(filePath)) {
    return void res.status(404).json({ error: 'File not found' });
  }
  try {
    res.json(await getVideoInfo(filePath));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  wmv: 'video/x-ms-wmv',
};

// Client aborts (e.g. a <video> element cancelling a seek) surface as
// premature-close errors after headers are sent; there is nothing left to
// tell the client, but pipeline still destroys the source stream so file
// descriptors are not leaked and 'error' never goes unhandled.
function streamFile(filePath: string, opts: { start?: number; end?: number } | undefined, res: NodeJS.WritableStream): void {
  pipeline(fs.createReadStream(filePath, opts), res, () => {});
}

videoRouter.get('/api/video/stream', (req, res) => {
  const filePath = String(req.query.path ?? '');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return void res.status(404).json({ error: 'File not found' });
  }
  const type = MIME[sourceExtension(filePath).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    });
    streamFile(filePath, undefined, res);
    return;
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m || (m[1] === '' && m[2] === '')) return void res.status(416).end();
  let start: number;
  let end: number;
  if (m[1] === '') {
    // Suffix range (RFC 7233): bytes=-N means the last N bytes.
    const suffix = Number(m[2]);
    if (suffix === 0) return void res.status(416).end();
    start = Math.max(0, stat.size - suffix);
    end = stat.size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? stat.size - 1 : Math.min(Number(m[2]), stat.size - 1);
  }
  if (start > end || start >= stat.size) return void res.status(416).end();

  res.writeHead(206, {
    'Content-Type': type,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
  });
  streamFile(filePath, { start, end }, res);
});
