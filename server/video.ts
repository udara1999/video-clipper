import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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
