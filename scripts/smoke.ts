// E2E smoke test: talks to a running server (npm run dev / npm start, or
// `npx tsx server/local.ts`) over real WebSockets, acting as one host and
// three phones. It never starts a server itself.
//
//   npx tsx scripts/smoke.ts
//   PORT=3199 npx tsx scripts/smoke.ts
//   WS_URL=wss://example.vercel.app/api/ws npx tsx scripts/smoke.ts
//
// Set CROSS_PORTS to two ports served by two processes that share one Redis
// (REDIS_URL) to also check the multi-instance path — bus relay and the
// ownership handover a Vercel host reconnect causes:
//
//   PORT=3131 CROSS_PORTS=3131,3132 npx tsx scripts/smoke.ts

import WebSocket from 'ws';

import type { C2S, S2C } from '../shared/protocol';
import { LOCAL_PORT, WS_PATH } from '../shared/protocol';
import { ROUND_MS } from '../shared/types';
import type { Snapshot } from '../shared/types';

const port = Number(process.env.PORT) || LOCAL_PORT;
const URL = process.env.WS_URL ?? `ws://localhost:${port}${WS_PATH}`;

const fail = (msg: string): never => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Never hang a CI job: the whole run is a handful of seconds of real time.
setTimeout(() => fail('the smoke test ran out of time'), 90_000).unref();

class Client {
  ws: WebSocket;
  inbox: S2C[] = [];
  constructor(
    public label: string,
    url: string = URL,
  ) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => this.inbox.push(JSON.parse(d.toString()) as S2C));
    this.ws.on('error', (e) => fail(`${label} ws error: ${e.message}`));
  }
  async open(timeoutMs = 8000): Promise<void> {
    await new Promise<void>((res) => {
      const timer = setTimeout(() => fail(`${this.label}: socket never opened`), timeoutMs);
      this.ws.once('open', () => {
        clearTimeout(timer);
        res();
      });
    });
  }
  send(m: C2S): void {
    this.ws.send(JSON.stringify(m));
  }
  async expect<T extends S2C['t']>(t: T, timeoutMs = 3000): Promise<Extract<S2C, { t: T }>> {
    const start = Date.now();
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Extract<S2C, { t: T }>;
      if (Date.now() - start > timeoutMs) return fail(`${this.label}: timed out waiting for '${t}'`);
      await sleep(20);
    }
  }
  /** Latest snapshot, after clearing anything already queued. */
  async freshState(): Promise<Snapshot> {
    this.inbox = this.inbox.filter((m) => m.t !== 'state');
    return (await this.expect('state')).s;
  }
}

// --- lobby -----------------------------------------------------------------

const host = new Client('host');
await host.open();
host.send({ t: 'hello-host' });
const room = await host.expect('room');
if (!/^[A-Z]{4}$/.test(room.code)) fail(`bad room code: ${room.code}`);
if ('joinUrl' in room) fail("'room' must not carry a joinUrl any more");
if (room.resumed === true) fail('a fresh room must not be resumed');
console.log(`room ${room.code}`);

const p1 = new Client('p1');
const p2 = new Client('p2');
await p1.open();
await p2.open();
p1.send({ t: 'join', room: room.code.toLowerCase(), name: 'Alice' });
const j1 = await p1.expect('joined');
p2.send({ t: 'join', room: room.code, name: 'Bob' });
const j2 = await p2.expect('joined');
if (j1.playerId === j2.playerId) fail('duplicate playerIds');
if (!j1.token || !j2.token || j1.token === j2.token) fail('joined must carry a unique seat token');

let roster = await host.expect('lobby');
while (host.inbox.some((m) => m.t === 'lobby')) roster = await host.expect('lobby');
if (roster.players.length !== 2) fail(`lobby roster has ${roster.players.length} players`);

// bad room join errors
const p3 = new Client('p3');
await p3.open();
p3.send({ t: 'join', room: 'ZZZZ', name: 'Nobody' });
await p3.expect('err');
p3.ws.close();

// malformed junk must not kill the server
p1.ws.send('not json {{{');
p1.send({ t: 'input', move: { x: NaN as unknown as number, y: 2 } });

// --- round -----------------------------------------------------------------

p1.send({ t: 'start' });
await host.expect('phase');
const first = await host.expect('state').then((m) => m.s);
if (first.phase !== 'playing') fail(`phase after start: ${first.phase}`);
if (first.players.length !== 2) fail(`snapshot has ${first.players.length} players`);
if (first.tiles.length !== first.w * first.h) fail('tiles length mismatch');
for (const t of ['crate', 'board', 'stove', 'plates', 'serve', 'trash'] as const) {
  if (!first.tiles.some((tile) => tile.t === t)) fail(`level missing tile type '${t}'`);
}

const before = first.players.find((p) => p.id === j1.playerId)!;
p1.send({ t: 'input', move: { x: 1, y: 0 } });
await sleep(700);
p1.send({ t: 'input', move: { x: 0, y: 0 } });
await sleep(200);
const after = await host.freshState();
const b = before.pos;
const a = after.players.find((p) => p.id === j1.playerId)!.pos;
const dist = Math.hypot(a.x - b.x, a.y - b.y);
if (dist < 0.5) fail(`player did not move (dist=${dist.toFixed(3)})`);
console.log(`movement ok (moved ${dist.toFixed(2)} tiles)`);

if (after.orders.length < 1) fail('no orders spawned');
if (after.msLeft <= 0 || after.msLeft > ROUND_MS + 1000) fail(`bad msLeft ${after.msLeft}`);

// --- controller reconnect keeps the seat and the body ----------------------

p2.ws.close();
await sleep(500);
const dropped = await host.freshState();
if (dropped.players.length !== 2) {
  fail(`a mid-round disconnect must keep the body (${dropped.players.length} players)`);
}
const bodyBefore = dropped.players.find((p) => p.id === j2.playerId);
if (!bodyBefore) fail('disconnected chef vanished from the snapshot');

const p2b = new Client('p2b');
await p2b.open();
p2b.send({ t: 'join', room: room.code, name: 'Somebody Else', token: j2.token });
const rejoined = await p2b.expect('joined');
if (rejoined.playerId !== j2.playerId) {
  fail(`token did not reclaim the seat (${rejoined.playerId} != ${j2.playerId})`);
}
if (rejoined.name !== j2.name || rejoined.color !== j2.color) {
  fail('reclaimed seat changed name or colour');
}
const resumedPhase = await p2b.expect('phase');
if (resumedPhase.phase !== 'playing') fail('the round must keep running through a reconnect');

const afterRejoin = await host.freshState();
if (afterRejoin.players.length !== 2) fail('reclaimed chef is missing from the sim');
if (afterRejoin.msLeft >= dropped.msLeft) fail('the clock stopped during a controller reconnect');
console.log(`controller reconnect ok (${rejoined.playerId} kept its seat)`);

// the reclaimed controller still drives its chef
const movedFrom = afterRejoin.players.find((p) => p.id === j2.playerId)!.pos;
p2b.send({ t: 'input', move: { x: -1, y: 0 } });
await sleep(600);
p2b.send({ t: 'input', move: { x: 0, y: 0 } });
const movedState = await host.freshState();
const movedTo = movedState.players.find((p) => p.id === j2.playerId)!.pos;
if (Math.hypot(movedTo.x - movedFrom.x, movedTo.y - movedFrom.y) < 0.3) {
  fail('reclaimed controller cannot move its chef');
}

// --- host reconnect resumes the room mid-round -----------------------------

const beforeHostDrop = await host.freshState();
host.ws.close();
await sleep(600);

const host2 = new Client('host2');
await host2.open();
host2.send({ t: 'hello-host', resume: { room: room.code } });
const resumedRoom = await host2.expect('room');
if (resumedRoom.code !== room.code) fail(`resume gave a different code: ${resumedRoom.code}`);
if (resumedRoom.resumed !== true) fail('resume must answer resumed:true');

const resumedLobby = await host2.expect('lobby');
if (resumedLobby.players.length !== 2) fail('resumed room lost its roster');

const s1 = await host2.expect('state').then((m) => m.s);
if (s1.phase !== 'playing') fail(`resumed room is in phase ${s1.phase}`);
if (s1.msLeft > ROUND_MS - 1000) fail(`msLeft reset on resume (${s1.msLeft})`);
if (s1.msLeft > beforeHostDrop.msLeft) fail('the clock went backwards on resume');
if (s1.score !== beforeHostDrop.score || s1.served !== beforeHostDrop.served) {
  fail('score did not survive the resume');
}
if (s1.players.length !== 2) fail('resumed room lost its chefs');

await sleep(400);
const s2 = await host2.freshState();
if (s2.msLeft >= s1.msLeft) fail('snapshots stopped flowing after the resume');
console.log(
  `host resume ok (resumed=${resumedRoom.resumed}, msLeft ${Math.round(s1.msLeft)} -> ` +
    `${Math.round(s2.msLeft)}, score ${s2.score})`,
);

// --- cross-instance: two processes, one Redis (opt-in) ---------------------

/**
 * The Vercel shape of the game: the host's room runs on one instance, a phone
 * lands on another, and the host's socket eventually dies and comes back
 * somewhere else. The room must follow the host, and the phone must keep its
 * chef without reconnecting.
 */
async function crossInstanceCheck(portA: number, portB: number): Promise<void> {
  const urlA = `ws://localhost:${portA}${WS_PATH}`;
  const urlB = `ws://localhost:${portB}${WS_PATH}`;

  const hostA = new Client('cross-host', urlA);
  await hostA.open();
  hostA.send({ t: 'hello-host' });
  const xr = await hostA.expect('room');

  // The phone talks to a process that has never heard of this room.
  const phone = new Client('cross-phone', urlB);
  await phone.open();
  phone.send({ t: 'join', room: xr.code, name: 'Remote Rita' });
  const seat = await phone.expect('joined', 8000);

  let seen = await hostA.expect('lobby');
  while (!seen.players.some((p) => p.name === 'Remote Rita')) seen = await hostA.expect('lobby');

  phone.send({ t: 'start' });
  await hostA.expect('phase');
  const x0 = await hostA.freshState();
  if (x0.phase !== 'playing') fail(`relayed start gave phase ${x0.phase}`);
  const spawn = { ...x0.players.find((p) => p.id === seat.playerId)!.pos };

  phone.send({ t: 'input', move: { x: 1, y: 0 } });
  await sleep(700);
  phone.send({ t: 'input', move: { x: 0, y: 0 } });
  await sleep(300);
  const x1 = await hostA.freshState();
  const walked = x1.players.find((p) => p.id === seat.playerId)!.pos;
  if (Math.hypot(walked.x - spawn.x, walked.y - spawn.y) < 0.5) {
    fail('relayed input did not move the chef');
  }
  console.log(`cross-instance relay ok (${seat.playerId} joined on B, drives on A)`);

  // The host's function dies on A and the page reconnects to B.
  hostA.ws.close();
  await sleep(800);
  const hostB = new Client('cross-host-2', urlB);
  await hostB.open();
  hostB.send({ t: 'hello-host', resume: { room: xr.code } });
  const resumed = await hostB.expect('room', 8000);
  if (resumed.code !== xr.code) fail('cross-instance resume gave a different code');
  if (resumed.resumed !== true) fail('cross-instance resume did not answer resumed:true');
  const x2 = await hostB.expect('state', 8000).then((m) => m.s);
  if (x2.phase !== 'playing') fail('the round did not survive the handover');
  if (x2.msLeft > ROUND_MS - 1000) fail(`msLeft reset on the handover (${x2.msLeft})`);
  if (x2.msLeft > x1.msLeft) fail('the clock went backwards on the handover');
  console.log(`cross-instance handover ok (msLeft ${Math.round(x2.msLeft)})`);

  // The phone never reconnected: its seat must have followed the room to B.
  // Walk back the way it came — the chef is parked next to the counter island,
  // so only the corridor it just crossed is guaranteed to be open floor.
  const from = { ...x2.players.find((p) => p.id === seat.playerId)!.pos };
  phone.send({ t: 'input', move: { x: -1, y: 0 } });
  await sleep(700);
  phone.send({ t: 'input', move: { x: 0, y: 0 } });
  await sleep(300);
  const x3 = await hostB.freshState();
  const to = x3.players.find((p) => p.id === seat.playerId)!.pos;
  if (Math.hypot(to.x - from.x, to.y - from.y) < 0.5) {
    fail('the relayed controller lost its chef after the handover');
  }
  console.log('cross-instance controller kept its chef through the handover');

  hostB.ws.close();
  phone.ws.close();
}

const crossPorts = (process.env.CROSS_PORTS ?? '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);

if (crossPorts.length === 2) {
  await crossInstanceCheck(crossPorts[0], crossPorts[1]);
  console.log(
    'PASS: lobby, join/err, start, snapshots, movement, orders, controller reclaim, ' +
      'host resume, cross-instance relay + handover all OK',
  );
} else if (crossPorts.length > 0) {
  fail('CROSS_PORTS needs exactly two ports, e.g. CROSS_PORTS=3131,3132');
} else {
  console.log(
    'PASS: lobby, join/err, start, snapshots, movement, orders, ' +
      'controller reclaim, host resume all OK',
  );
}
process.exit(0);
