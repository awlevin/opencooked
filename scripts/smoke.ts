// E2E smoke test: talks to a running server (npm start / tsx server/index.ts)
// over real WebSockets, acting as one host + two phone controllers.
// Usage: npx tsx scripts/smoke.ts
import WebSocket from 'ws';
import type { C2S, S2C } from '../shared/protocol';
import { SERVER_PORT, WS_PATH } from '../shared/protocol';
import type { Snapshot } from '../shared/types';

const URL = `ws://localhost:${SERVER_PORT}${WS_PATH}`;
const fail = (msg: string): never => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

class Client {
  ws: WebSocket;
  inbox: S2C[] = [];
  constructor(public label: string) {
    this.ws = new WebSocket(URL);
    this.ws.on('message', (d) => this.inbox.push(JSON.parse(d.toString()) as S2C));
    this.ws.on('error', (e) => fail(`${label} ws error: ${e.message}`));
  }
  async open() {
    await new Promise<void>((res) => this.ws.once('open', () => res()));
  }
  send(m: C2S) {
    this.ws.send(JSON.stringify(m));
  }
  async expect<T extends S2C['t']>(t: T, timeoutMs = 3000): Promise<Extract<S2C, { t: T }>> {
    const start = Date.now();
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Extract<S2C, { t: T }>;
      if (Date.now() - start > timeoutMs) return fail(`${this.label}: timed out waiting for '${t}'`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

const host = new Client('host');
await host.open();
host.send({ t: 'hello-host', clientPort: 5173 });
const room = await host.expect('room');
if (!/^[A-Z]{4}$/.test(room.code)) fail(`bad room code: ${room.code}`);
if (!room.joinUrl.includes(room.code)) fail(`joinUrl missing code: ${room.joinUrl}`);
console.log(`room ${room.code} joinUrl ${room.joinUrl}`);

const p1 = new Client('p1');
const p2 = new Client('p2');
await p1.open();
await p2.open();
p1.send({ t: 'join', room: room.code.toLowerCase(), name: 'Alice' });
const j1 = await p1.expect('joined');
p2.send({ t: 'join', room: room.code, name: 'Bob' });
const j2 = await p2.expect('joined');
if (j1.playerId === j2.playerId) fail('duplicate playerIds');

// host should have seen a roster with both players by now
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

p1.send({ t: 'start' });
await host.expect('phase');
const first = (await host.expect('state')).s as Snapshot;
if (first.phase !== 'playing') fail(`phase after start: ${first.phase}`);
if (first.players.length !== 2) fail(`snapshot has ${first.players.length} players`);
if (first.tiles.length !== first.w * first.h) fail('tiles length mismatch');
for (const t of ['crate', 'board', 'stove', 'plates', 'serve', 'trash'] as const) {
  if (!first.tiles.some((tile) => tile.t === t)) fail(`level missing tile type '${t}'`);
}

const before = first.players.find((p) => p.id === j1.playerId)!;
p1.send({ t: 'input', move: { x: 1, y: 0 } });
await new Promise((r) => setTimeout(r, 700));
p1.send({ t: 'input', move: { x: 0, y: 0 } });
await new Promise((r) => setTimeout(r, 200));
host.inbox.length = 0;
const after = (await host.expect('state')).s as Snapshot;
const b = before.pos;
const a = after.players.find((p) => p.id === j1.playerId)!.pos;
const dist = Math.hypot(a.x - b.x, a.y - b.y);
if (dist < 0.5) fail(`player did not move (dist=${dist.toFixed(3)})`);
console.log(`movement ok (moved ${dist.toFixed(2)} tiles)`);

if (after.orders.length < 1) fail('no orders spawned');
if (after.msLeft <= 0 || after.msLeft > 181000) fail(`bad msLeft ${after.msLeft}`);

// disconnect a controller -> roster shrinks in snapshots
p2.ws.close();
await new Promise((r) => setTimeout(r, 400));
host.inbox.length = 0;
const afterLeave = (await host.expect('state')).s as Snapshot;
if (afterLeave.players.length !== 1) fail(`player not removed on disconnect (${afterLeave.players.length})`);

console.log('PASS: lobby, join/err, start, snapshots, movement, orders, disconnect all OK');
process.exit(0);
