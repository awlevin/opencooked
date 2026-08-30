// ffmpeg plumbing. The binaries ship with the demo package (ffmpeg-static /
// ffprobe-static) so a re-capture needs nothing installed on the machine.

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

import type { CapturedFrame } from './frames.ts';

export const ffmpeg: string = ffmpegStatic ?? 'ffmpeg';
export const ffprobe: string = ffprobeStatic.path ?? 'ffprobe';

export function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} exited ${code}\n${err.slice(-3000)}`)),
    );
  });
}

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
}

export async function probe(file: string): Promise<VideoInfo> {
  const json = await run(ffprobe, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height:format=duration',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(json) as {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string };
  };
  return {
    width: parsed.streams?.[0]?.width ?? 0,
    height: parsed.streams?.[0]?.height ?? 0,
    duration: Number(parsed.format?.duration ?? 0),
  };
}

/**
 * Screencast frames arrive whenever Chromium paints, so they are not evenly
 * spaced. Feed ffmpeg the real inter-frame gaps through the concat demuxer and
 * let `fps=` resample to a constant rate — that keeps motion honest instead of
 * assuming every frame lasted 1/30 s.
 */
export async function encodeFrames(
  frames: CapturedFrame[],
  dir: string,
  out: string,
  fps: number,
): Promise<VideoInfo> {
  if (frames.length < 2) throw new Error(`only ${frames.length} frame(s) captured in ${dir}`);

  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) {
    const next = frames[i + 1];
    lines.push(`file '${frames[i].file}'`);
    if (next) {
      const dt = Math.min(2, Math.max(1 / 240, next.t - frames[i].t));
      lines.push(`duration ${dt.toFixed(5)}`);
    }
  }
  // The concat demuxer ignores the last entry's duration, so repeat the frame.
  lines.push(`file '${frames[frames.length - 1].file}'`);
  const list = path.join(dir, 'list.txt');
  await writeFile(list, `${lines.join('\n')}\n`);

  await run(ffmpeg, [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-vf',
    `fps=${fps}`,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '17',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    out,
  ]);
  return probe(out);
}
