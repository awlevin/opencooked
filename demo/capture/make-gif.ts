// assets/demo.gif — a tight loop of the best moment in the take: a chef
// running a finished soup to the window and the score ticking up.
//
//   npm run gif        (inside demo/, after `npm run capture`)
//
// Steps down through quality settings until the file fits the budget, so the
// README never ends up with a 20 MB gif.

import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ffmpeg, run } from './ffmpeg.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(HERE, '..');
const ROOT = path.resolve(DEMO, '..');
const SOURCE = path.join(DEMO, 'captures', 'host.mp4');
const OUT = path.join(ROOT, 'assets', 'demo.gif');

const MAX_BYTES = 8 * 1024 * 1024;
/** Seconds of run-up before the serve lands, and of reaction after it. */
const LEAD_S = 5.5;
const TAIL_S = 2.5;

interface Meta {
  serves: number[];
  hostDuration: number;
}

/** Quality ladder: first one that fits the budget wins. */
const LADDER = [
  { width: 960, fps: 20, colors: 224 },
  { width: 960, fps: 16, colors: 192 },
  { width: 900, fps: 15, colors: 160 },
  { width: 820, fps: 13, colors: 128 },
  { width: 720, fps: 12, colors: 96 },
];

async function main(): Promise<void> {
  const meta = (await import('../captures/meta.json', { with: { type: 'json' } })).default as Meta;
  const serve = meta.serves[0];
  if (serve === undefined) throw new Error('no serve in the capture to build a gif around');

  const start = Math.max(0, serve - LEAD_S);
  const duration = Math.min(LEAD_S + TAIL_S, meta.hostDuration - start);
  await mkdir(path.dirname(OUT), { recursive: true });

  for (const [i, step] of LADDER.entries()) {
    const filter =
      `fps=${step.fps},scale=${step.width}:-2:flags=lanczos,split[a][b];` +
      `[a]palettegen=max_colors=${step.colors}:stats_mode=diff[p];` +
      `[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`;
    await rm(OUT, { force: true });
    await run(ffmpeg, [
      '-y',
      '-ss',
      start.toFixed(3),
      '-t',
      duration.toFixed(3),
      '-i',
      SOURCE,
      '-filter_complex',
      filter,
      '-loop',
      '0',
      OUT,
    ]);
    const { size } = await stat(OUT);
    const mb = (size / 1024 / 1024).toFixed(2);
    if (size <= MAX_BYTES) {
      console.log(
        `assets/demo.gif — ${step.width}px, ${step.fps} fps, ${duration.toFixed(1)}s, ${mb} MB ` +
          `(serve at ${serve.toFixed(1)}s of the take)`,
      );
      return;
    }
    console.log(`  ${step.width}px/${step.fps}fps came out at ${mb} MB, trying smaller…`);
    if (i === LADDER.length - 1) throw new Error(`cannot get demo.gif under 8 MB (last try ${mb} MB)`);
  }
}

await main();
