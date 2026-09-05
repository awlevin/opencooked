// Rules tests for the authoritative sim.
//
// The Game is a plain deterministic class, so a test can drive it exactly the
// way the transport does — press a button, tick a frame — and read the truth
// straight off `snapshot`. Players are teleported next to a station instead of
// walked there: pathing is not what these tests are about.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLevel } from '../shared/levels';
import type { IngredientType, Snapshot, Tile, TileType } from '../shared/types';
import {
  BURN_MS,
  CHOP_MS,
  COOK_MS,
  POT_CAPACITY,
  TICK_MS,
} from '../shared/types';
import { Game } from './game';

/* ------------------------------- harness -------------------------------- */

const LEVEL = createLevel();

/** Every tile index of one type, in reading order. */
function indicesOf(t: TileType): number[] {
  const out: number[] = [];
  LEVEL.tiles.forEach((tile, i) => {
    if (tile.t === t) out.push(i);
  });
  return out;
}

const xyOf = (i: number): { x: number; y: number } => ({
  x: i % LEVEL.w,
  y: Math.floor(i / LEVEL.w),
});

/** A floor tile a chef can stand on to work `idx`, and the facing to use. */
function accessOf(idx: number): { stand: { x: number; y: number }; dir: { x: number; y: number } } {
  const s = xyOf(idx);
  for (const d of [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]) {
    const sx = s.x - d.x;
    const sy = s.y - d.y;
    if (sx < 0 || sy < 0 || sx >= LEVEL.w || sy >= LEVEL.h) continue;
    if (LEVEL.tiles[sy * LEVEL.w + sx]!.t !== 'floor') continue;
    return { stand: { x: sx, y: sy }, dir: d };
  }
  throw new Error(`no access to tile ${idx}`);
}

interface Harness {
  g: Game;
  snap: Snapshot;
  /** Teleport a chef onto the access tile of `idx` and face the station. */
  face(idx: number, id?: string): void;
  /** One A press, resolved on the next tick. */
  a(id?: string): void;
  /** Hold B for `ms`, ticking the whole time, then release. */
  holdB(ms: number, id?: string): void;
  tick(ms: number): void;
  /** Advance `ms` in TICK_MS slices, so timers see realistic dt. */
  run(ms: number): void;
  tile(idx: number): Tile;
}

function harness(players = 1, seed = 7): Harness {
  const g = new Game({ seed });
  for (let i = 0; i < players; i++) g.addPlayer(`p${i}`, `P${i}`, '#fff');
  g.start();
  const snap = g.snapshot;
  const h: Harness = {
    g,
    snap,
    face(idx, id = 'p0') {
      const p = snap.players.find((q) => q.id === id);
      assert.ok(p, `no player ${id}`);
      const { stand, dir } = accessOf(idx);
      p.pos = { x: stand.x, y: stand.y };
      p.dir = { x: dir.x, y: dir.y };
    },
    a(id = 'p0') {
      g.press(id, 'a');
      g.tick(TICK_MS);
    },
    holdB(ms, id = 'p0') {
      g.press(id, 'b');
      h.run(ms);
      g.release(id, 'b');
      g.tick(TICK_MS);
    },
    tick(ms) {
      g.tick(ms);
    },
    run(ms) {
      let left = ms;
      while (left > 0) {
        const step = Math.min(TICK_MS, left);
        g.tick(step);
        left -= step;
      }
    },
    tile(idx) {
      const t = snap.tiles[idx];
      assert.ok(t, `no tile ${idx}`);
      return t;
    },
  };
  return h;
}

const CRATES = indicesOf('crate');
const BOARDS = indicesOf('board');
const STOVES = indicesOf('stove');
const PLATES = indicesOf('plates');
const SERVE = indicesOf('serve');
const TRASH = indicesOf('trash');
/** Counters with a free access tile, so a test can put things down anywhere. */
const COUNTERS = indicesOf('counter').filter((i) => {
  try {
    accessOf(i);
    return true;
  } catch {
    return false;
  }
});

const held = (h: Harness, id = 'p0') => h.snap.players.find((p) => p.id === id)!.held;

/** Drop `n` chopped ingredients of one type straight into a stove pot. */
function fillPot(h: Harness, stove: number, type: IngredientType = 'onion', n = POT_CAPACITY): void {
  const pot = h.tile(stove).pot;
  assert.ok(pot);
  for (let i = 0; i < n; i++) pot.contents.push(type);
  pot.state = 'cooking';
  pot.cookMs = 0;
}

/* ------------------------------ base rules ------------------------------ */

test('a fresh round has a stocked kitchen and one order', () => {
  const h = harness();
  assert.equal(h.snap.phase, 'playing');
  assert.equal(h.snap.orders.length, 1);
  assert.ok(STOVES.length >= 1 && BOARDS.length >= 1 && CRATES.length === 3);
});

test('crate gives a raw ingredient; a full hand takes nothing', () => {
  const h = harness();
  h.face(CRATES[0]!);
  h.a();
  assert.equal(held(h)?.kind, 'ingredient');
  const first = held(h);
  h.a();
  assert.equal(held(h), first, 'a second press must not swap what you carry');
});

test('board: place, chop while B is down, pick back up', () => {
  const h = harness();
  h.face(CRATES[0]!);
  h.a();
  h.face(BOARDS[0]!);
  h.a();
  assert.equal(h.tile(BOARDS[0]!).item?.kind, 'ingredient');
  assert.equal(held(h), null);

  h.holdB(CHOP_MS + TICK_MS * 2);
  const item = h.tile(BOARDS[0]!).item;
  assert.ok(item?.kind === 'ingredient' && item.ing.chopped);

  h.a();
  assert.equal(held(h)?.kind, 'ingredient');
  assert.equal(h.tile(BOARDS[0]!).item, null);
});

test('two chefs on one board is not a speedup', () => {
  const h = harness(2);
  h.face(CRATES[0]!);
  h.a();
  h.face(BOARDS[0]!);
  h.a();
  // Both stand on the same access tile and hold B for half a chop.
  h.face(BOARDS[0]!, 'p1');
  h.g.press('p0', 'b');
  h.g.press('p1', 'b');
  h.run(CHOP_MS * 0.6);
  const item = h.tile(BOARDS[0]!).item;
  assert.ok(item?.kind === 'ingredient' && !item.ing.chopped);
});

test('pot cooks only when full, then burns if ignored', () => {
  const h = harness();
  const pot = h.tile(STOVES[0]!).pot!;
  fillPot(h, STOVES[0]!, 'onion', POT_CAPACITY - 1);
  h.run(COOK_MS * 2);
  assert.equal(pot.state, 'cooking', 'a half-full pot never finishes');

  pot.contents.push('onion');
  h.run(COOK_MS + TICK_MS);
  assert.equal(pot.state, 'done');
  h.run(BURN_MS + TICK_MS);
  assert.equal(pot.state, 'burnt');
});

test('plate fills from a done pot and serves a matching order', () => {
  const h = harness();
  const recipe = h.snap.orders[0]!.recipe;
  const stove = STOVES[0]!;
  const pot = h.tile(stove).pot!;
  pot.contents = [...recipe];
  pot.state = 'done';
  pot.cookMs = 0;

  h.face(PLATES[0]!);
  h.a();
  assert.equal(held(h)?.kind, 'plate');
  h.face(stove);
  h.a();
  const plate = held(h);
  assert.ok(plate?.kind === 'plate' && plate.soup?.length === POT_CAPACITY);
  assert.equal(pot.state, 'idle');
  assert.equal(pot.contents.length, 0);

  h.face(SERVE[0]!);
  h.a();
  assert.equal(held(h), null);
  assert.equal(h.snap.served, 1);
  assert.ok(h.snap.score > 0);
});

test('trash empties a soup plate but keeps the plate', () => {
  const h = harness();
  h.face(PLATES[0]!);
  h.a();
  const plate = held(h);
  assert.ok(plate?.kind === 'plate');
  plate.soup = ['onion', 'onion', 'onion'];
  h.face(TRASH[0]!);
  h.a();
  const after = held(h);
  assert.ok(after?.kind === 'plate' && after.soup === null);
});

test('an empty-handed chef dumps a burnt stove pot', () => {
  const h = harness();
  const pot = h.tile(STOVES[0]!).pot!;
  pot.contents = ['onion', 'onion', 'onion'];
  pot.state = 'burnt';
  h.face(STOVES[0]!);
  h.a();
  assert.equal(pot.state, 'idle');
  assert.equal(pot.contents.length, 0);
});

test('a counter holds exactly one item', () => {
  const h = harness();
  h.face(CRATES[0]!);
  h.a();
  h.face(COUNTERS[0]!);
  h.a();
  assert.equal(held(h), null);
  h.face(CRATES[1]!);
  h.a();
  h.face(COUNTERS[0]!);
  h.a();
  assert.equal(held(h)?.kind, 'ingredient', 'the counter is taken; keep holding');
});

test('restoreSnapshot round-trips a mid-round kitchen', () => {
  const h = harness(2);
  h.face(CRATES[0]!);
  h.a();
  fillPot(h, STOVES[0]!);
  h.run(1000);

  const wire = JSON.parse(JSON.stringify(h.snap)) as Snapshot;
  const g2 = new Game({ seed: 7 });
  g2.restoreSnapshot(wire);
  // Player input state is deliberately not restored, so compare the rest.
  assert.deepEqual(
    { ...g2.snapshot, players: g2.snapshot.players.map((p) => ({ ...p, chopping: false })) },
    { ...wire, players: wire.players.map((p) => ({ ...p, chopping: false })) },
  );
  // Deep copy, not aliasing: mutating the restore must not touch the source.
  g2.snapshot.tiles[STOVES[0]!]!.pot!.contents.push('tomato');
  assert.equal(wire.tiles[STOVES[0]!]!.pot!.contents.length, POT_CAPACITY);
});

/* --------------------------- pots as cookware --------------------------- */

test('empty hands lift a pot off its ring and set it back down', () => {
  const h = harness();
  const stove = STOVES[0]!;
  h.face(stove);
  h.a();
  const item = held(h);
  assert.ok(item?.kind === 'pot');
  assert.equal(h.tile(stove).pot, null, 'the ring is left bare');

  h.a();
  assert.equal(held(h), null);
  assert.equal(h.tile(stove).pot, item.pot, 'the same pot goes back');
});

test('a pot rides to a counter and back', () => {
  const h = harness();
  h.face(STOVES[0]!);
  h.a();
  h.face(COUNTERS[0]!);
  h.a();
  assert.equal(held(h), null);
  assert.equal(h.tile(COUNTERS[0]!).item?.kind, 'pot');

  h.a();
  assert.equal(held(h)?.kind, 'pot');
  assert.equal(h.tile(COUNTERS[0]!).item, null);
});

test('boards, crates, plate stacks and the serve window refuse a pot', () => {
  const h = harness();
  h.face(STOVES[0]!);
  h.a();
  for (const idx of [BOARDS[0]!, CRATES[0]!, PLATES[0]!, SERVE[0]!]) {
    h.face(idx);
    h.a();
    assert.equal(held(h)?.kind, 'pot', `tile ${idx} must not take the pot`);
  }
  assert.equal(h.tile(BOARDS[0]!).item, null);
});

test('a pot off the heat freezes, and resumes where it left off', () => {
  const h = harness();
  const stove = STOVES[0]!;
  fillPot(h, stove);
  h.run(COOK_MS * 0.5);
  h.face(stove);
  h.a();
  const carried = held(h);
  assert.ok(carried?.kind === 'pot');
  // Read the clock once the pot is off the heat: the pickup tick itself still
  // cooked, because timers run before button presses inside a tick.
  const partway = carried.pot.cookMs;
  assert.ok(partway > 0);
  h.run(COOK_MS * 2);
  assert.equal(carried.pot.cookMs, partway, 'carried pots do not cook');
  assert.equal(carried.pot.state, 'cooking');

  // Parked on a counter it stays just as frozen.
  h.face(COUNTERS[0]!);
  h.a();
  h.run(COOK_MS * 2);
  const parked = h.tile(COUNTERS[0]!).item;
  assert.ok(parked?.kind === 'pot' && parked.pot.cookMs === partway);

  h.a();
  h.face(stove);
  h.a();
  h.run(COOK_MS - partway + TICK_MS);
  assert.equal(h.tile(stove).pot!.state, 'done', 'the ring picks the timer back up');
});

test('a counter pot takes chopped ingredients and fills a plate', () => {
  const h = harness();
  const counter = COUNTERS[0]!;
  h.face(STOVES[0]!);
  h.a();
  h.face(counter);
  h.a();

  for (let i = 0; i < POT_CAPACITY; i++) {
    h.face(CRATES[0]!);
    h.a();
    h.face(BOARDS[0]!);
    h.a();
    h.holdB(CHOP_MS + TICK_MS * 2);
    h.a();
    h.face(counter);
    h.a();
    assert.equal(held(h), null, 'the counter pot swallowed the ingredient');
  }
  const item = h.tile(counter).item;
  assert.ok(item?.kind === 'pot' && item.pot.contents.length === POT_CAPACITY);
  assert.equal(item.pot.state, 'cooking');

  // Nothing cooks off the ring, so cheat it to done and scoop it out.
  item.pot.state = 'done';
  item.pot.cookMs = 0;
  h.face(PLATES[0]!);
  h.a();
  h.face(counter);
  h.a();
  const plate = held(h);
  assert.ok(plate?.kind === 'plate' && plate.soup?.length === POT_CAPACITY);
  assert.equal(item.pot.state, 'idle');
  assert.equal(item.pot.contents.length, 0);
});

test('a full pot in hand refuses more and pours into a waiting plate', () => {
  const h = harness();
  const stove = STOVES[0]!;
  const counter = COUNTERS[0]!;
  fillPot(h, stove);
  h.run(COOK_MS + TICK_MS);
  assert.equal(h.tile(stove).pot!.state, 'done');

  // Park an empty plate on a counter, then bring the pot to it.
  h.face(PLATES[0]!);
  h.a();
  h.face(counter);
  h.a();
  h.face(stove);
  h.a();
  const carried = held(h);
  assert.ok(carried?.kind === 'pot');

  h.face(counter);
  h.a();
  const plate = h.tile(counter).item;
  assert.ok(plate?.kind === 'plate' && plate.soup?.length === POT_CAPACITY);
  assert.equal(carried.pot.state, 'idle');
  assert.equal(carried.pot.contents.length, 0);
  assert.equal(held(h), carried, 'the pot stays in your hands');

  // A second pour has nothing to give, so the plate keeps its soup.
  h.a();
  assert.equal(plate.soup?.length, POT_CAPACITY);
});

test('trash tips a pot out and hands it straight back', () => {
  const h = harness();
  const stove = STOVES[0]!;
  const pot = h.tile(stove).pot!;
  pot.contents = ['onion', 'tomato'];
  pot.state = 'cooking';
  h.face(stove);
  h.a();
  h.face(TRASH[0]!);
  h.a();
  const carried = held(h);
  assert.ok(carried?.kind === 'pot');
  assert.equal(carried.pot.contents.length, 0);
  assert.equal(carried.pot.state, 'idle');
});

test('a burnt pot on a counter is dumped before it can be carried', () => {
  const h = harness();
  const counter = COUNTERS[0]!;
  const stove = STOVES[0]!;
  const pot = h.tile(stove).pot!;
  pot.contents = ['onion', 'onion', 'onion'];
  pot.state = 'burnt';
  h.face(stove);
  h.a(); // burnt pot on a ring: dump first
  assert.equal(pot.state, 'idle');
  pot.contents = ['onion', 'onion', 'onion'];
  pot.state = 'burnt';

  // Move the (burnt) pot by hand: dump, lift, carry, and burn it on the counter.
  h.a(); // dump
  h.a(); // lift
  h.face(counter);
  h.a();
  const item = h.tile(counter).item;
  assert.ok(item?.kind === 'pot');
  item.pot.contents = ['onion', 'onion', 'onion'];
  item.pot.state = 'burnt';

  h.a();
  assert.equal(held(h), null, 'the first press only tips the char out');
  assert.equal(item.pot.state, 'idle');
  h.a();
  assert.equal(held(h)?.kind, 'pot');
});

test('a chef who leaves does not take the pot with them', () => {
  const h = harness(2);
  h.face(STOVES[0]!, 'p1');
  h.g.press('p1', 'a');
  h.tick(TICK_MS);
  assert.equal(h.snap.players.find((p) => p.id === 'p1')!.held?.kind, 'pot');
  h.g.removePlayer('p1');
  assert.ok(STOVES.some((i) => h.tile(i).pot), 'the pot is back on a ring');
});

test('restoreSnapshot round-trips a carried pot and a bare ring', () => {
  const h = harness();
  const stove = STOVES[0]!;
  fillPot(h, stove, 'tomato', 2);
  h.face(stove);
  h.a();

  const wire = JSON.parse(JSON.stringify(h.snap)) as Snapshot;
  const g2 = new Game({ seed: 7 });
  g2.restoreSnapshot(wire);
  assert.equal(g2.snapshot.tiles[stove]!.pot, null, 'the empty ring survives');
  const restored = g2.snapshot.players[0]!.held;
  assert.ok(restored?.kind === 'pot');
  assert.deepEqual(restored.pot.contents, ['tomato', 'tomato']);
  restored.pot.contents.push('onion');
  const source = wire.players[0]!.held;
  assert.ok(source?.kind === 'pot' && source.pot.contents.length === 2);
});
