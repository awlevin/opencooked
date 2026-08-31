// Films a real round of Opencooked.
//
// Boots the game on a scratch port, opens the host TV screen at exactly
// 1920x1080 and a phone controller at 390x844, sits three cooking bots
// (scripts/demo-bots.ts) at the same table, and records both pages with the
// Chromium screencast API. A take is only kept when the score actually moved:
// >= MIN_SERVES soup delivered inside ACCEPT_WINDOW_S. Up to MAX_TAKES tries.
//
//   npm run capture            (inside demo/)
//
// Output: demo/captures/{host,phone}.mp4 + meta.json, mirrored into
// demo/public/ where Remotion's staticFile() can reach them.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type CDPSession, type Page } from 'playwright';

import { BotTeam } from '../../scripts/demo-bots.ts';
import type { S2C } from '../../shared/protocol.ts';
import type { Snapshot } from '../../shared/types.ts';
import { encodeFrames } from './ffmpeg.ts';
import { FrameSink } from './frames.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(HERE, '..');
const ROOT = path.resolve(DEMO, '..');
const CAPTURES = path.join(DEMO, 'captures');
const PUBLIC = path.join(DEMO, 'public');
const SCRATCH = path.join(CAPTURES, '.frames');

const PORT = Number(process.env.DEMO_PORT) || 3777;
const PLAY_SECONDS = Number(process.env.DEMO_SECONDS) || 50;
/** A take must land this many soups inside the window to be usable. */
const MIN_SERVES = Number(process.env.DEMO_MIN_SERVES ?? 2);
const ACCEPT_WINDOW_S = Number(process.env.DEMO_ACCEPT_WINDOW ?? 40);
const MAX_TAKES = 3;

const HOST_W = 1920;
const HOST_H = 1080;
const PHONE_W = 390;
const PHONE_H = 844;
/** Phone renders at 2x so the picture-in-picture stays sharp when scaled. */
const PHONE_SCALE = 2;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ----------------------------- meta contract ---------------------------- */

export interface PhoneEvent {
  /** Seconds into phone.mp4. */
  t: number;
  kind: 'move' | 'grab';
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A moment worth pointing a label at: when, and which tile it happened on. */
export interface Beat {
  /** Seconds into host.mp4. */
  t: number;
  /** Tile coordinates in the kitchen grid. */
  x: number;
  y: number;
}

export interface CaptureMeta {
  /** Seconds into host.mp4 when the round actually started. */
  roundStart: number;
  /** Seconds into host.mp4 for each successful serve. */
  serves: number[];
  /** Every time a chef put the knife down on a fresh ingredient. */
  chops: Beat[];
  /** Every time a pot filled up and started cooking. */
  cooks: Beat[];
  /** Kitchen grid, so the edit can map a tile back to a spot on screen. */
  gridW: number;
  gridH: number;
  serveTile: { x: number; y: number };
  hostDuration: number;
  phoneDuration: number;
  hostWidth: number;
  hostHeight: number;
  phoneWidth: number;
  phoneHeight: number;
  phoneEvents: PhoneEvent[];
  /** Where the joystick and the GRAB button sit on the phone screen, in CSS px. */
  phoneStick: Box;
  phoneGrab: Box;
  finalScore: number;
  finalServed: number;
  takes: number;
  room: string;
}

/* -------------------------------- server -------------------------------- */

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never answered on ${url}`);
    await sleep(400);
  }
}

function startServer(): ChildProcess {
  if (!existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
    throw new Error('no production build found — run `npm run build` in the repo root first');
  }
  const child = spawn('npx', ['tsx', 'server/local.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[server] ${d}`));
  return child;
}

/* ------------------------------- screencast ----------------------------- */

interface Recorder {
  cdp: CDPSession;
  sink: FrameSink;
  stop: () => Promise<void>;
}

async function record(page: Page, dir: string, maxW: number, maxH: number): Promise<Recorder> {
  const cdp = await page.context().newCDPSession(page);
  const sink = new FrameSink(dir);
  await sink.open();
  let stopped = false;

  cdp.on('Page.screencastFrame', (frame) => {
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    if (stopped) return;
    sink.push(frame.data, frame.metadata.timestamp ?? 0);
  });

  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: maxW,
    maxHeight: maxH,
    everyNthFrame: 1,
  });

  return {
    cdp,
    sink,
    stop: async () => {
      stopped = true;
      await cdp.send('Page.stopScreencast').catch(() => {});
      await sink.close();
    },
  };
}

/* --------------------------------- take --------------------------------- */

interface TakeResult {
  ok: boolean;
  meta: CaptureMeta | null;
  reason: string;
}

async function runTake(browser: Browser, take: number): Promise<TakeResult> {
  const wsUrl = `ws://127.0.0.1:${PORT}/api/ws`;
  const frameDir = path.join(SCRATCH, `take${take}`);
  await rm(frameDir, { recursive: true, force: true });

  const hostCtx = await browser.newContext({
    viewport: { width: HOST_W, height: HOST_H },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const phoneCtx = await browser.newContext({
    viewport: { width: PHONE_W, height: PHONE_H },
    deviceScaleFactor: PHONE_SCALE,
    hasTouch: true,
    isMobile: false,
  });

  let bots: BotTeam | null = null;
  let hostRec: Recorder | null = null;
  let phoneRec: Recorder | null = null;

  try {
    const host = await hostCtx.newPage();

    // The host socket is the only one that gets snapshots, and the host page
    // owns it — so we read the brains' world state straight off its frames.
    let room = '';
    let latest: Snapshot | null = null;
    let served = 0;
    let recordingSince = 0;
    const serves: number[] = [];
    const chops: Beat[] = [];
    const cooks: Beat[] = [];
    let chopping = false;
    let lastChopAt = -99;
    const fullPots = new Set<number>();
    const now = (): number => (recordingSince ? (Date.now() - recordingSince) / 1000 : 0);

    host.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => {
        let msg: S2C;
        try {
          msg = JSON.parse(typeof payload === 'string' ? payload : payload.toString()) as S2C;
        } catch {
          return;
        }
        if (msg.t === 'room') room = msg.code;
        if (msg.t !== 'state') return;
        const s = msg.s;
        latest = s;
        bots?.feed(s);
        if (!recordingSince) return;
        if (s.served > served) {
          for (let i = served; i < s.served; i++) serves.push(now());
          served = s.served;
        }
        // Rising edges only: "someone started chopping", "a pot just filled".
        // Each beat carries the tile it happened on, so a label can point at it.
        const knives = s.players.some((p) => p.chopping);
        if (knives && !chopping && now() - lastChopAt > 2) {
          const bi = s.tiles.findIndex((t) => t.t === 'board' && (t.chopMs ?? 0) > 0);
          if (bi >= 0) {
            chops.push({ t: now(), x: bi % s.w, y: Math.floor(bi / s.w) });
            lastChopAt = now();
          }
        }
        chopping = knives;
        s.tiles.forEach((t, i) => {
          const full = t.pot?.state === 'cooking' && t.pot.contents.length >= 3;
          if (!full) {
            fullPots.delete(i);
            return;
          }
          if (fullPots.has(i)) return;
          fullPots.add(i);
          cooks.push({ t: now(), x: i % s.w, y: Math.floor(i / s.w) });
        });
      });
    });

    await host.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    const deadline = Date.now() + 20_000;
    while (!room && Date.now() < deadline) await sleep(100);
    if (!room) throw new Error('host page never got a room code');
    console.log(`take ${take}: room ${room}`);

    // The phone: a real controller page, joined the way a guest would.
    const phone = await phoneCtx.newPage();
    await phone.goto(`http://127.0.0.1:${PORT}/join?room=${room}`, { waitUntil: 'load' });
    await phone.locator('input.input').fill('Sage');
    await phone.locator('button.big-btn').click();
    await phone.locator('.screen--lobby').waitFor({ timeout: 15_000 });

    bots = new BotTeam({ wsUrl, room, log: (m) => console.log(`  ${m}`) });
    await bots.connect();
    await sleep(1200); // let the roster settle on both screens

    hostRec = await record(host, path.join(frameDir, 'host'), HOST_W, HOST_H);
    phoneRec = await record(phone, path.join(frameDir, 'phone'), PHONE_W * PHONE_SCALE, PHONE_H * PHONE_SCALE);
    recordingSince = Date.now();
    await sleep(1500); // a beat of lobby before the whistle

    const roundStart = now();
    await phone.locator('button.big-btn').click(); // "START" from the lobby
    await phone.locator('.screen--pad').waitFor({ timeout: 15_000 });

    const acted = await drivePhone(phone, now, PLAY_SECONDS * 1000);

    await hostRec.stop();
    await phoneRec.stop();
    const hostFrames = hostRec.sink.frames;
    const phoneFrames = phoneRec.sink.frames;
    hostRec = null;
    phoneRec = null;

    const snap = latest as Snapshot | null;
    const inWindow = serves.filter((t) => t - roundStart <= ACCEPT_WINDOW_S).length;
    if (inWindow < MIN_SERVES || !snap || snap.score <= 0) {
      return {
        ok: false,
        meta: null,
        reason: `only ${inWindow} serve(s) inside ${ACCEPT_WINDOW_S}s (score ${snap?.score ?? 0})`,
      };
    }

    const span = (hostFrames[hostFrames.length - 1]?.t ?? 0) - (hostFrames[0]?.t ?? 0);
    console.log(
      `take ${take}: ${snap.served} served, score ${snap.score}; ` +
        `${hostFrames.length} host frames over ${span.toFixed(1)}s (${(hostFrames.length / (span || 1)).toFixed(1)} fps); encoding…`,
    );
    const hostOut = path.join(CAPTURES, 'host.mp4');
    const phoneOut = path.join(CAPTURES, 'phone.mp4');
    const hostInfo = await encodeFrames(hostFrames, path.join(frameDir, 'host'), hostOut, 30);
    const phoneInfo = await encodeFrames(phoneFrames, path.join(frameDir, 'phone'), phoneOut, 30);

    return {
      ok: true,
      reason: 'ok',
      meta: {
        roundStart,
        // Snapshots keep arriving while ffmpeg works; only keep what is on film.
        serves: serves.filter((t) => t <= hostInfo.duration),
        chops,
        cooks,
        gridW: snap.w,
        gridH: snap.h,
        serveTile: (() => {
          const i = snap.tiles.findIndex((t) => t.t === 'serve');
          return { x: i % snap.w, y: Math.floor(i / snap.w) };
        })(),
        hostDuration: hostInfo.duration,
        phoneDuration: phoneInfo.duration,
        hostWidth: hostInfo.width,
        hostHeight: hostInfo.height,
        phoneWidth: phoneInfo.width,
        phoneHeight: phoneInfo.height,
        phoneEvents: acted.events,
        phoneStick: acted.stick,
        phoneGrab: acted.grab,
        finalScore: snap.score,
        finalServed: snap.served,
        takes: take,
        room,
      },
    };
  } finally {
    await hostRec?.stop().catch(() => {});
    await phoneRec?.stop().catch(() => {});
    bots?.stop();
    await phoneCtx.close().catch(() => {});
    await hostCtx.close().catch(() => {});
  }
}

/* ------------------------------ phone acting ---------------------------- */

/**
 * Thumbs on glass. The bots carry the round; this chef is here so the
 * picture-in-picture shows a real joystick moving and a real GRAB landing.
 * It stays in the quiet bottom-left of the kitchen and out of their way.
 */
async function drivePhone(
  page: Page,
  now: () => number,
  durationMs: number,
): Promise<{ events: PhoneEvent[]; stick: Box; grab: Box }> {
  const events: PhoneEvent[] = [];
  const stick = await page.locator('.stick-zone').boundingBox();
  const grab = await page.locator('.pad-btn--a').boundingBox();
  if (!stick || !grab) throw new Error('controller layout not found');

  const origin = { x: stick.x + stick.width * 0.5, y: stick.y + stick.height * 0.62 };
  const grabAt = { x: grab.x + grab.width / 2, y: grab.y + grab.height / 2 };
  const THROW = 48; // px of thumb travel — a touch under the stick's max

  const drag = async (dx: number, dy: number, ms: number): Promise<void> => {
    events.push({ t: now(), kind: 'move' });
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(origin.x + (dx * THROW * i) / steps, origin.y + (dy * THROW * i) / steps);
      await sleep(16);
    }
    await sleep(Math.max(0, ms - steps * 16));
    await page.mouse.up();
  };

  const tapGrab = async (): Promise<void> => {
    events.push({ t: now(), kind: 'grab' });
    await page.mouse.move(grabAt.x, grabAt.y);
    await page.mouse.down();
    await sleep(140);
    await page.mouse.up();
  };

  const end = Date.now() + durationMs;
  // Off the crates and down to the quiet bottom-left corner, where the bots'
  // routes (crates -> boards -> stoves -> serve window) never go.
  await drag(0, 1, 1100);
  await drag(-1, 0, 700);

  // A calm loop that stays in that corner, with the odd grab at the bin.
  const beat: Array<[number, number, number]> = [
    [1, 0, 700],
    [0, 1, 500],
    [-1, 0, 700],
    [0, -1, 500],
  ];
  let i = 0;
  while (Date.now() < end) {
    const [dx, dy, ms] = beat[i % beat.length];
    await drag(dx, dy, ms);
    await sleep(220);
    if (i % 3 === 2) {
      await tapGrab();
      await sleep(320);
    }
    i++;
  }
  await page.mouse.move(origin.x, origin.y);
  // The stick re-centres on the touch origin, so that — not the zone — is
  // where the video actually shows a thumb.
  return {
    events,
    stick: { x: origin.x - THROW, y: origin.y - THROW, width: THROW * 2, height: THROW * 2 },
    grab,
  };
}

/* --------------------------------- main --------------------------------- */

async function main(): Promise<void> {
  await mkdir(CAPTURES, { recursive: true });
  await mkdir(PUBLIC, { recursive: true });

  const server = startServer();
  let browser: Browser | null = null;
  const kill = (): void => {
    if (!server.killed) server.kill('SIGTERM');
  };
  process.on('exit', kill);
  process.on('SIGINT', () => {
    kill();
    process.exit(130);
  });

  try {
    await waitForServer(`http://127.0.0.1:${PORT}/join`);
    console.log(`server up on :${PORT}`);
    browser = await chromium.launch({
      args: [
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-gpu-vsync',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });

    let meta: CaptureMeta | null = null;
    for (let take = 1; take <= MAX_TAKES && !meta; take++) {
      const res = await runTake(browser, take);
      if (res.ok && res.meta) {
        meta = res.meta;
        break;
      }
      console.log(`take ${take} rejected: ${res.reason}`);
    }
    if (!meta) throw new Error(`no usable take after ${MAX_TAKES} tries`);

    await writeFile(path.join(CAPTURES, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
    for (const f of ['host.mp4', 'phone.mp4']) {
      await copyFile(path.join(CAPTURES, f), path.join(PUBLIC, f));
    }
    await rm(SCRATCH, { recursive: true, force: true });

    console.log(
      `\ncaptured in ${meta.takes} take(s): score ${meta.finalScore}, ${meta.finalServed} served\n` +
        `  host  ${meta.hostWidth}x${meta.hostHeight} ${meta.hostDuration.toFixed(1)}s\n` +
        `  phone ${meta.phoneWidth}x${meta.phoneHeight} ${meta.phoneDuration.toFixed(1)}s\n` +
        `  serves at ${meta.serves.map((s) => `${s.toFixed(1)}s`).join(', ')}`,
    );
  } finally {
    await browser?.close().catch(() => {});
    kill();
    // The Next server keeps a handful of timers alive; do not linger.
    setTimeout(() => process.exit(0), 500).unref();
  }
}

await main();
