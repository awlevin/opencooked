// Room rules around choosing a level.
//
// A Room is transport-agnostic on purpose, so a test can be the transport: a
// `Link` here is an array of everything the room said. The store and bus are
// the same in-memory pair a LAN party runs on, which means these tests exercise
// the real persistence path a host resume goes through.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Game } from '../game/game';
import type { S2C } from '../shared/protocol';
import { DEFAULT_LEVEL_ID } from '../shared/levels';
import { ROOM_TTL_MS } from './config';
import type { Link } from './link';
import { MemoryBus, MemoryStore } from './memory';
import { Room } from './room';
import type { RoomCtx } from './room';
import type { Store } from './store';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class TestLink implements Link {
  readonly local = true;
  readonly peer = false;
  readonly sent: S2C[] = [];
  closed = false;

  constructor(readonly id: string) {}

  send(msg: S2C): void {
    this.sent.push(msg);
  }

  close(msg?: S2C): void {
    if (msg) this.sent.push(msg);
    this.closed = true;
  }

  /** The most recent message of one kind, which is all these tests ever want. */
  last<T extends S2C['t']>(t: T): Extract<S2C, { t: T }> | null {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i]!.t === t) return this.sent[i] as Extract<S2C, { t: T }>;
    }
    return null;
  }
}

function context(store: Store): RoomCtx {
  return {
    store,
    bus: new MemoryBus(),
    instanceId: 'test-instance',
    isCodeTaken: () => false,
    onDestroyed: () => undefined,
    onMigrate: () => undefined,
  };
}

/** A room with a host screen and one phone, sitting in the lobby. */
async function lobbyRoom(): Promise<{
  room: Room;
  host: TestLink;
  phone: TestLink;
  store: Store;
  ctx: RoomCtx;
}> {
  const store = new MemoryStore(ROOM_TTL_MS);
  const ctx = context(store);
  const room = await Room.createFresh(ctx);
  const host = new TestLink('host');
  room.attachHost(host, false);
  const phone = new TestLink('phone');
  room.handleMessage(phone, { t: 'join', room: room.code, name: 'Alice' });
  return { room, host, phone, store, ctx };
}

test('the lobby broadcast carries the chosen level', async () => {
  const { room, host, phone } = await lobbyRoom();
  assert.equal(host.last('lobby')?.levelId, DEFAULT_LEVEL_ID);
  assert.equal(phone.last('lobby')?.levelId, DEFAULT_LEVEL_ID);

  room.handleMessage(phone, { t: 'select', levelId: 'sushi-2' });
  assert.equal(room.snapshot.levelId, 'sushi-2');
  assert.equal(host.last('lobby')?.levelId, 'sushi-2');
  assert.equal(phone.last('lobby')?.levelId, 'sushi-2');

  // A phone that joins after the choice is made sees the same kitchen.
  const late = new TestLink('late');
  room.handleMessage(late, { t: 'join', room: room.code, name: 'Bob' });
  assert.equal(late.last('lobby')?.levelId, 'sushi-2');
  room.destroy('done');
});

test('only a chef in the lobby may pick the level', async () => {
  const { room, phone } = await lobbyRoom();

  // Junk ids and strangers change nothing.
  room.handleMessage(phone, { t: 'select', levelId: 'nope' });
  assert.equal(room.snapshot.levelId, DEFAULT_LEVEL_ID);
  const stranger = new TestLink('stranger');
  room.handleMessage(stranger, { t: 'select', levelId: 'grill-1' });
  assert.equal(room.snapshot.levelId, DEFAULT_LEVEL_ID);

  // Mid-round the kitchen is not up for discussion: swapping it would tip
  // every chef into another building.
  room.handleMessage(phone, { t: 'start' });
  assert.equal(room.phase, 'playing');
  room.handleMessage(phone, { t: 'select', levelId: 'grill-1' });
  assert.equal(room.snapshot.levelId, DEFAULT_LEVEL_ID);
  room.destroy('done');
});

test('the choice survives a host resume', async () => {
  const { room, phone, store, ctx } = await lobbyRoom();
  const code = room.code;
  room.handleMessage(phone, { t: 'select', levelId: 'grill-3' });
  await sleep(30); // the registry write is fire-and-forget

  const rec = await store.getRoom(code);
  assert.equal(rec?.levelId, 'grill-3');

  // The host's function died and the page reconnected somewhere else.
  room.standDown();
  const resumed = await Room.adopt(ctx, rec!);
  assert.ok(resumed);
  assert.equal(resumed.snapshot.levelId, 'grill-3');
  const host2 = new TestLink('host2');
  resumed.attachHost(host2, true);
  assert.equal(host2.last('lobby')?.levelId, 'grill-3');
  resumed.destroy('done');
});

test('"next level" is Play Again with a destination', async () => {
  // Stand a room up straight into gameover, the way a resumed host would.
  const store = new MemoryStore(ROOM_TTL_MS);
  const ctx = context(store);
  const over = new Game({ seed: 1, levelId: 'home-2' });
  over.addPlayer('p1', 'Alice', '#fff');
  over.start();
  // A tick integrates at most MAX_DT_MS, so run the clock out in slices.
  for (let i = 0; i < 1000 && over.phase === 'playing'; i++) over.tick(250);
  assert.equal(over.phase, 'gameover');

  const rec = {
    code: 'ABCD',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    phase: 'gameover' as const,
    seq: 2,
    seats: [
      {
        playerId: 'p1',
        name: 'Alice',
        color: '#fff',
        token: 'tok',
        connected: false,
        disconnectedAt: null,
      },
    ],
    levelId: 'home-2',
    owner: null,
    hostConnected: false,
  };
  await store.createRoom(rec);
  await store.putSnapshot(rec.code, over.snapshot);

  const room = (await Room.adopt(ctx, rec))!;
  assert.equal(room.snapshot.levelId, 'home-2');
  const host = new TestLink('host');
  room.attachHost(host, true);
  const phone = new TestLink('phone');
  room.handleMessage(phone, { t: 'join', room: rec.code, name: 'Alice', token: 'tok' });

  // The results are still on screen: the level only moves through "again".
  room.handleMessage(phone, { t: 'select', levelId: 'sushi-1' });
  assert.equal(room.snapshot.levelId, 'home-2');

  room.handleMessage(phone, { t: 'again', levelId: 'home-3' });
  assert.equal(room.phase, 'lobby');
  assert.equal(room.snapshot.levelId, 'home-3');
  assert.equal(host.last('lobby')?.levelId, 'home-3');
  room.destroy('done');
});

/**
 * Who paused, by name, or null. A function rather than a field read because
 * `assert.equal` is an assertion signature: comparing `snapshot.paused` to
 * null would narrow that property to `null` for the rest of the test.
 */
const pausedBy = (room: Room): string | null => room.snapshot.paused?.name ?? null;

test('any phone pauses, any phone resumes, and the host screen cannot', async () => {
  const { room, host, phone } = await lobbyRoom();
  const other = new TestLink('other');
  room.handleMessage(other, { t: 'join', room: room.code, name: 'Bob' });
  room.handleMessage(phone, { t: 'start' });
  assert.equal(room.phase, 'playing');
  assert.equal(pausedBy(room), null);

  // The host screen has no seat: it cooks nothing, so it stops nothing.
  room.handleMessage(host, { t: 'pause' });
  assert.equal(pausedBy(room), null);

  room.handleMessage(phone, { t: 'pause' });
  assert.equal(pausedBy(room), 'Alice');
  assert.equal(phone.last('paused')?.by?.name, 'Alice');
  assert.equal(other.last('paused')?.by?.name, 'Alice');
  assert.equal(host.last('paused')?.by?.name, 'Alice');
  // The TV must not wait up to a snapshot interval to show the freeze.
  assert.equal(host.last('state')?.s.paused?.name, 'Alice');

  // A phone that joins mid-pause is told before it can paint a gamepad.
  const late = new TestLink('late');
  room.handleMessage(late, { t: 'join', room: room.code, name: 'Cleo' });
  assert.equal(late.last('paused')?.by?.name, 'Alice');

  // Somebody else presses Resume.
  room.handleMessage(other, { t: 'resume' });
  assert.equal(pausedBy(room), null);
  assert.equal(phone.last('paused')?.by, null);
  room.destroy('done');
});

test('a pause survives the host resuming somewhere else', async () => {
  const { room, phone, store, ctx } = await lobbyRoom();
  const code = room.code;
  room.handleMessage(phone, { t: 'start' });
  room.handleMessage(phone, { t: 'pause' });
  await sleep(30); // the checkpoint is fire-and-forget

  const rec = await store.getRoom(code);
  assert.ok(rec);
  room.standDown();

  const resumed = await Room.adopt(ctx, rec);
  assert.ok(resumed);
  assert.equal(pausedBy(resumed), 'Alice');
  const host2 = new TestLink('host2');
  resumed.attachHost(host2, true);
  assert.equal(host2.last('state')?.s.paused?.name, 'Alice');
  resumed.destroy('done');
});
