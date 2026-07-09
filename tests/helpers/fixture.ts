import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const execFileP = promisify(execFile);

export const FIXTURE = fileURLToPath(new URL('../fixtures/test-10s.mp4', import.meta.url));

// 10s synthetic video, keyframe every second (gop 30 at 30fps) so tests can
// reason about where cuts snap.
export async function ensureFixture(): Promise<string> {
  if (fs.existsSync(FIXTURE)) return FIXTURE;
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  await execFileP(ffmpegPath!, [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc=duration=10:size=320x240:rate=30',
    '-c:v', 'libx264',
    '-g', '30',
    '-pix_fmt', 'yuv420p',
    FIXTURE,
  ]);
  return FIXTURE;
}
