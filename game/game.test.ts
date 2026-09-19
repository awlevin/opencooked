// Rules tests for the authoritative sim.
//
// The Game is a plain deterministic class, so a test can drive it exactly the
// way the transport does — press a button, tick a frame — and read the truth
// straight off `snapshot`. Players are teleported next to a station instead of
// walked there: pathing is not what these tests are about.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DISHES, INGREDIENTS, type DishId, type IngredientType } from '../shared/catalogue';
import { createLevel } from '../shared/levels';
import type {
  FxEvent,
  HeldItem,
  Ingredient,
  Pot,
  Snapshot,
  Tile,
  TileType,
} from '../shared/types';
import {
  BURN_MS,
  CHOP_MS,
  COOK_MS,
  EXTINGUISH_MS,
  FIRE_MS,
  FIRE_SPREAD_MS,
  FRY_MS,
  FX_MAX,
  FX_TTL_MS,
  ORDER_SPAWN_MS,
  POT_CAPACITY,
  SERVE_POINTS,
  SERVE_TIME_BONUS_MAX,
  TICK_MS,
} from '../shared/types';
import { Game } from './game';

/* ------------------------------- harness -------------------------------- */

/**
 * The kitchen these tests cook in. Home Kitchen 3 is the one level that runs
 * pots and a pan side by side off six crates, so every rule in the book —
 * boiling, frying, plating a burger — can be driven in one geometry.
 */
const TEST_LEVEL_ID = 'home-3';
const LEVEL = createLevel(TEST_LEVEL_ID);

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
  /** One A tap — pressed and let go inside a single tick. */
  a(id?: string): void;
  /** Hold A for `ms`, ticking the whole time, then release. */
  holdA(ms: number, id?: string): void;
  /** Hold B for `ms`, ticking the whole time, then release. */
  holdB(ms: number, id?: string): void;
  tick(ms: number): void;
  /** Advance `ms` in TICK_MS slices, so timers see realistic dt. */
  run(ms: number): void;
  tile(idx: number): Tile;
}

function harness(players = 1, seed = 7, menu?: DishId[]): Harness {
  const g = new Game({ seed, menu, levelId: TEST_LEVEL_ID });
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
      // A is held as well as tapped now (it is the knife at a board), so a
      // test that means "tap" has to let go before the tick resolves it.
      g.press(id, 'a');
      g.release(id, 'a');
      g.tick(TICK_MS);
    },
    holdA(ms, id = 'p0') {
      g.press(id, 'a');
      h.run(ms);
      g.release(id, 'a');
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
/** Boiling rings and the frying ring are both 'stove' tiles; the vessel differs. */
const STOVES = indicesOf('stove').filter((i) => LEVEL.tiles[i]!.pot?.kind === 'pot');
const PANS = indicesOf('stove').filter((i) => LEVEL.tiles[i]!.pot?.kind === 'pan');
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

/**
 * Stand on the diagonal neighbour of a station and lean into it. Two chefs
 * cannot share one access tile — they push each other off it — so this is how
 * a test gets both of them working the same station.
 */
function faceCorner(h: Harness, idx: number, id: string): void {
  const p = h.snap.players.find((q) => q.id === id)!;
  const s = xyOf(idx);
  for (const d of [
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: -1 },
  ]) {
    const sx = s.x + d.x;
    const sy = s.y + d.y;
    if (sx < 0 || sy < 0 || sx >= LEVEL.w || sy >= LEVEL.h) continue;
    if (LEVEL.tiles[sy * LEVEL.w + sx]!.t !== 'floor') continue;
    p.pos = { x: sx, y: sy };
    p.dir = { x: -d.x / Math.SQRT2, y: -d.y / Math.SQRT2 };
    return;
  }
  throw new Error(`no diagonal access to tile ${idx}`);
}

const held = (h: Harness, id = 'p0') => h.snap.players.find((p) => p.id === id)!.held;

/** Straight out of the crate: nothing has been done to it yet. */
const rawOnion = (): Ingredient => ({ type: 'onion', chopped: false, cooked: false });

/** A prepared ingredient, ready for a pot (chopped, not yet cooked). */
const chopped = (type: IngredientType): Ingredient => ({ type, chopped: true, cooked: false });

/** A finished ingredient, ready for a plate. */
const done = (type: IngredientType): Ingredient => ({ type, chopped: true, cooked: true });

/** The crate that stocks one ingredient in the starter kitchen. */
function crateOf(type: IngredientType): number {
  const i = CRATES.find((idx) => LEVEL.tiles[idx]!.crate === type);
  assert.ok(i !== undefined, `no ${type} crate`);
  return i;
}

/** Cheat a vessel to 'done', exactly as a tick would: contents cooked too. */
function finish(pot: Pot): void {
  pot.state = 'done';
  pot.cookMs = 0;
  for (const ing of pot.contents) ing.cooked = true;
}

/** The types on a plate / in a pot, sorted — what the rules actually compare. */
const partsOf = (list: readonly Ingredient[]): IngredientType[] =>
  list.map((i) => i.type).sort();

/** Drop `n` chopped ingredients of one type straight into a stove pot. */
function fillPot(h: Harness, stove: number, type: IngredientType = 'onion', n = POT_CAPACITY): void {
  const pot = h.tile(stove).pot;
  assert.ok(pot);
  for (let i = 0; i < n; i++) pot.contents.push(chopped(type));
  pot.state = 'cooking';
  pot.cookMs = 0;
}

/* ------------------------------ base rules ------------------------------ */

test('a fresh round has a stocked kitchen and one order', () => {
  const h = harness();
  assert.equal(h.snap.phase, 'playing');
  assert.equal(h.snap.orders.length, 1);
  assert.ok(STOVES.length >= 1 && BOARDS.length >= 1);
  const stocked = new Set(CRATES.map((i) => LEVEL.tiles[i]!.crate));
  for (const veg of ['onion', 'tomato', 'mushroom']) assert.ok(stocked.has(veg as never));
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

  pot.contents.push(chopped('onion'));
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
  pot.contents = recipe.map(done);
  pot.state = 'done';
  pot.cookMs = 0;

  h.face(PLATES[0]!);
  h.a();
  assert.equal(held(h)?.kind, 'plate');
  h.face(stove);
  h.a();
  const plate = held(h);
  assert.ok(plate?.kind === 'plate' && plate.contents.length === POT_CAPACITY);
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
  plate.contents = [done('onion'), done('onion'), done('onion')];
  h.face(TRASH[0]!);
  h.a();
  const after = held(h);
  assert.ok(after?.kind === 'plate' && after.contents.length === 0);
});

test('an empty-handed chef dumps a burnt stove pot', () => {
  const h = harness();
  const pot = h.tile(STOVES[0]!).pot!;
  pot.contents = [done('onion'), done('onion'), done('onion')];
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
  const g2 = new Game({ seed: 7, levelId: TEST_LEVEL_ID });
  g2.restoreSnapshot(wire);
  // Player input state is deliberately not restored, so compare the rest.
  assert.deepEqual(
    { ...g2.snapshot, players: g2.snapshot.players.map((p) => ({ ...p, chopping: false })) },
    { ...wire, players: wire.players.map((p) => ({ ...p, chopping: false })) },
  );
  // Deep copy, not aliasing: mutating the restore must not touch the source.
  g2.snapshot.tiles[STOVES[0]!]!.pot!.contents.push(chopped('tomato'));
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
  finish(item.pot);
  h.face(PLATES[0]!);
  h.a();
  h.face(counter);
  h.a();
  const plate = held(h);
  assert.ok(plate?.kind === 'plate' && plate.contents.length === POT_CAPACITY);
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
  assert.ok(plate?.kind === 'plate' && plate.contents.length === POT_CAPACITY);
  assert.equal(carried.pot.state, 'idle');
  assert.equal(carried.pot.contents.length, 0);
  assert.equal(held(h), carried, 'the pot stays in your hands');

  // A second pour has nothing to give, so the plate keeps its soup.
  h.a();
  assert.equal(plate.contents.length, POT_CAPACITY);
});

test('trash tips a pot out and hands it straight back', () => {
  const h = harness();
  const stove = STOVES[0]!;
  const pot = h.tile(stove).pot!;
  pot.contents = [chopped('onion'), chopped('tomato')];
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
  pot.contents = [done('onion'), done('onion'), done('onion')];
  pot.state = 'burnt';
  h.face(stove);
  h.a(); // burnt pot on a ring: dump first
  assert.equal(pot.state, 'idle');
  pot.contents = [done('onion'), done('onion'), done('onion')];
  pot.state = 'burnt';

  // Move the (burnt) pot by hand: dump, lift, carry, and burn it on the counter.
  h.a(); // dump
  h.a(); // lift
  h.face(counter);
  h.a();
  const item = h.tile(counter).item;
  assert.ok(item?.kind === 'pot');
  item.pot.contents = [done('onion'), done('onion'), done('onion')];
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
  const g2 = new Game({ seed: 7, levelId: TEST_LEVEL_ID });
  g2.restoreSnapshot(wire);
  assert.equal(g2.snapshot.tiles[stove]!.pot, null, 'the empty ring survives');
  const restored = g2.snapshot.players[0]!.held;
  assert.ok(restored?.kind === 'pot');
  assert.deepEqual(partsOf(restored.pot.contents), ['tomato', 'tomato']);
  restored.pot.contents.push(chopped('onion'));
  const source = wire.players[0]!.held;
  assert.ok(source?.kind === 'pot' && source.pot.contents.length === 2);
});

/* ---------------------------- fire and foam ----------------------------- */

const MOUNT = indicesOf('extinguisher')[0]!;

/**
 * Light a tile outright. Ignition is private to the sim (only a ruined pot or
 * a spreading fire may start one), so a test that needs a fire on a specific
 * tile reaches in for it.
 */
const igniteTile = (h: Harness, idx: number): void =>
  (h.g as unknown as { ignite(tile: Tile): void }).ignite(h.tile(idx));

/** Leave a burnt pot on a ring and wait for it to catch. */
function ignite(h: Harness, stove: number): void {
  const pot = h.tile(stove).pot!;
  pot.contents = [done('onion'), done('onion'), done('onion')];
  pot.state = 'burnt';
  pot.cookMs = 0;
  h.run(FIRE_MS + TICK_MS);
}

test('the level hangs exactly one extinguisher on the wall', () => {
  const h = harness();
  assert.equal(indicesOf('extinguisher').length, 1);
  assert.equal(h.tile(MOUNT).item?.kind, 'extinguisher');
});

test('a burnt pot on its ring catches fire, and not a moment early', () => {
  const h = harness();
  const stove = STOVES[0]!;
  const pot = h.tile(stove).pot!;
  pot.contents = [done('onion'), done('onion'), done('onion')];
  pot.state = 'burnt';
  pot.cookMs = 0;
  h.run(FIRE_MS * 0.8);
  assert.equal(h.tile(stove).fire, undefined);
  h.run(FIRE_MS * 0.3);
  assert.deepEqual(h.tile(stove).fire, { ms: h.tile(stove).fire!.ms, sprayMs: 0 });
  assert.ok(h.tile(stove).fire!.ms >= 0);
});

test('a burnt pot off the heat never catches', () => {
  const h = harness();
  const stove = STOVES[0]!;
  const pot = h.tile(stove).pot!;
  pot.contents = [chopped('onion')];
  pot.state = 'burnt';
  // Carry the char around: the ignition clock is the ring's, not the pot's.
  h.face(stove);
  h.a(); // dumps the char
  h.a(); // lifts the clean pot
  const carried = held(h);
  assert.ok(carried?.kind === 'pot');
  carried.pot.state = 'burnt';
  carried.pot.contents = [chopped('onion')];
  h.run(FIRE_MS * 3);
  assert.equal(h.snap.tiles.filter((t) => t.fire).length, 0);
});

test('fire spreads to one neighbour per FIRE_SPREAD_MS, sparing the way out', () => {
  const h = harness();
  ignite(h, STOVES[0]!);
  assert.equal(h.snap.tiles.filter((t) => t.fire).length, 1);
  h.run(FIRE_SPREAD_MS + TICK_MS);
  assert.equal(h.snap.tiles.filter((t) => t.fire).length, 2);
  h.run(FIRE_SPREAD_MS);
  assert.ok(h.snap.tiles.filter((t) => t.fire).length >= 3);
  for (const tile of h.snap.tiles) {
    if (!tile.fire) continue;
    assert.notEqual(tile.t, 'floor');
    assert.notEqual(tile.t, 'serve');
    assert.notEqual(tile.t, 'extinguisher');
  }
});

test('catching fire ruins food but never the equipment', () => {
  const h = harness();
  const counter = COUNTERS[0]!;
  const plateCounter = COUNTERS[1]!;
  // A pot with soup and a plate, side by side, both set alight.
  h.face(STOVES[0]!);
  h.a();
  h.face(counter);
  h.a();
  const potItem = h.tile(counter).item;
  assert.ok(potItem?.kind === 'pot');
  potItem.pot.contents = [chopped('onion'), chopped('tomato')];
  potItem.pot.state = 'cooking';
  h.face(PLATES[0]!);
  h.a();
  h.face(plateCounter);
  h.a();

  igniteTile(h, counter);
  igniteTile(h, plateCounter);
  assert.equal(potItem.pot.state, 'burnt', 'the pot survives, its soup does not');
  assert.deepEqual(partsOf(potItem.pot.contents), ['onion', 'tomato']);
  assert.equal(h.tile(counter).item, potItem);
  assert.equal(h.tile(plateCounter).item, null, 'the plate is gone');
});

test('a burning tile refuses every A press', () => {
  const h = harness();
  const stove = STOVES[0]!;
  ignite(h, stove);
  h.face(stove);
  h.a();
  assert.equal(held(h), null, 'no grabbing out of a fire');
  assert.ok(h.tile(stove).pot, 'and nothing is dumped either');

  h.face(CRATES[0]!);
  h.a();
  h.face(stove);
  h.a();
  assert.equal(held(h)?.kind, 'ingredient', 'and nothing goes in');
});

test('the extinguisher comes off its bracket and goes back on', () => {
  const h = harness();
  h.face(MOUNT);
  h.a();
  assert.equal(held(h)?.kind, 'extinguisher');
  assert.equal(h.tile(MOUNT).item, null);

  h.face(COUNTERS[0]!);
  h.a();
  assert.equal(h.tile(COUNTERS[0]!).item?.kind, 'extinguisher');
  h.a();
  h.face(TRASH[0]!);
  h.a();
  assert.equal(held(h)?.kind, 'extinguisher', 'the bin will not take it');
  h.face(MOUNT);
  h.a();
  assert.equal(held(h), null);
  assert.equal(h.tile(MOUNT).item?.kind, 'extinguisher');
});

test('B sprays instead of dashing while the extinguisher is in hand', () => {
  const h = harness();
  h.face(MOUNT);
  h.a();
  h.face(COUNTERS[0]!);
  h.g.press('p0', 'b');
  h.run(200);
  const p = h.snap.players[0]!;
  assert.equal(p.spraying, true, 'the trigger always makes foam');
  assert.equal(p.dashMsLeft, 0, 'and never a dash');
  h.g.release('p0', 'b');
  h.tick(TICK_MS);
  assert.equal(h.snap.players[0]!.spraying, false);
});

test('foam puts a fire out, and two chefs are not faster than one', () => {
  const h = harness(2);
  const stove = STOVES[0]!;
  ignite(h, stove);
  h.face(MOUNT);
  h.a();
  h.face(stove);
  faceCorner(h, stove, 'p1');
  // The kitchen only has one extinguisher, so hand the second chef a spare to
  // prove the rule: foam from two nozzles is still one fire's worth per tick.
  h.snap.players[1]!.held = { kind: 'extinguisher' };

  h.g.press('p0', 'b');
  h.g.press('p1', 'b');
  h.run(EXTINGUISH_MS * 0.6);
  assert.ok(h.tile(stove).fire, 'a second chef is not a speedup');
  assert.equal(h.snap.players[1]!.spraying, true, 'though both are spraying');
  h.run(EXTINGUISH_MS * 0.5);
  assert.equal(h.tile(stove).fire, undefined);

  // The pot is still ruined; dumping it is the usual chore.
  h.g.release('p0', 'b');
  h.g.release('p1', 'b');
  h.face(COUNTERS[0]!);
  h.a();
  assert.equal(held(h), null);
  h.face(stove);
  assert.equal(h.tile(stove).pot!.state, 'burnt');
  h.a();
  assert.equal(h.tile(stove).pot!.state, 'idle');
});

test('putting a fire out buzzes everyone who was spraying it', () => {
  const h = harness();
  const stove = STOVES[0]!;
  ignite(h, stove);
  h.face(MOUNT);
  h.a();
  h.face(stove);
  h.g.press('p0', 'b');
  let buzzed = 0;
  for (let t = 0; t < EXTINGUISH_MS + TICK_MS * 2; t += TICK_MS) {
    buzzed += h.g.tick(TICK_MS).length;
  }
  assert.equal(buzzed, 1);
});

test('a burning board cannot be chopped on', () => {
  const h = harness();
  const board = BOARDS[0]!;
  h.face(CRATES[0]!);
  h.a();
  h.face(board);
  h.a();
  igniteTile(h, board);
  assert.equal(h.tile(board).item, null, 'the ingredient burned up');
  h.holdB(CHOP_MS);
  assert.equal(h.snap.players[0]!.chopping, false);
});

test('restoreSnapshot round-trips fire and the extinguisher', () => {
  const h = harness();
  const stove = STOVES[0]!;
  ignite(h, stove);
  h.face(MOUNT);
  h.a();
  h.face(stove); // mid-spray: the restored chef must still be aimed at the fire
  h.tile(stove).fire!.sprayMs = 400;

  const wire = JSON.parse(JSON.stringify(h.snap)) as Snapshot;
  const g2 = new Game({ seed: 7, levelId: TEST_LEVEL_ID });
  g2.restoreSnapshot(wire);
  assert.deepEqual(g2.snapshot.tiles[stove]!.fire, h.tile(stove).fire);
  assert.equal(g2.snapshot.tiles[MOUNT]!.item, null);
  assert.equal(g2.snapshot.players[0]!.held?.kind, 'extinguisher');
  assert.equal(g2.snapshot.players[0]!.spraying, false);

  // A restored fire keeps burning and can still be put out.
  g2.snapshot.tiles[stove]!.fire!.sprayMs = EXTINGUISH_MS - 10;
  g2.press('p0', 'b');
  g2.tick(TICK_MS);
  assert.equal(g2.snapshot.tiles[stove]!.fire, undefined);
});

test('a chef who leaves hangs the extinguisher back up', () => {
  const h = harness(2);
  h.face(MOUNT, 'p1');
  h.g.press('p1', 'a');
  h.tick(TICK_MS);
  assert.equal(h.snap.players.find((p) => p.id === 'p1')!.held?.kind, 'extinguisher');
  h.g.removePlayer('p1');
  assert.equal(h.tile(MOUNT).item?.kind, 'extinguisher');
});

/* -------------------------- catalogue and menu -------------------------- */

test('every order is a dish on the menu, with that dish\'s parts', () => {
  const h = harness();
  h.run(ORDER_SPAWN_MS * 3);
  assert.ok(h.snap.orders.length >= 2);
  assert.ok(h.snap.dishes.length > 0);
  for (const o of h.snap.orders) {
    assert.ok(h.snap.dishes.includes(o.dish), `${o.dish} is not on the menu`);
    assert.deepEqual(o.recipe, DISHES[o.dish].parts);
  }
});

test('a menu the kitchen cannot cook refuses to start', () => {
  // The starter kitchen has no rice, fish or seaweed crates.
  assert.throws(() => new Game({ seed: 1, menu: ['nigiri'], levelId: TEST_LEVEL_ID }), /Fish crate/);
  assert.throws(() => new Game({ seed: 1, menu: [], levelId: TEST_LEVEL_ID }), /at least one dish/);
  // And a dish it can cook is accepted.
  assert.doesNotThrow(() => new Game({ seed: 1, menu: ['onion-soup'], levelId: TEST_LEVEL_ID }));
});

test('a pot boils one batch size at a time: rice is a single portion', () => {
  const h = harness();
  const stove = STOVES[0]!;
  const pot = h.tile(stove).pot!;
  const p = h.snap.players[0]!;

  p.held = { kind: 'ingredient', ing: { type: 'rice', chopped: false, cooked: false } };
  h.face(stove);
  h.a();
  assert.equal(p.held, null, 'rice needs no chopping to go in');
  assert.equal(pot.contents.length, 1);
  assert.equal(pot.state, 'cooking');

  // A second portion has nowhere to go: rice boils one at a time.
  p.held = { kind: 'ingredient', ing: { type: 'rice', chopped: false, cooked: false } };
  h.a();
  assert.equal(held(h)?.kind, 'ingredient', 'the pot is already a full batch');

  h.run(COOK_MS + TICK_MS);
  assert.equal(pot.state, 'done');
  assert.ok(pot.contents.every((i) => i.cooked), 'cooking is what marks it ready');
});

test('a pot of rice refuses a vegetable, and vice versa', () => {
  const h = harness();
  const stove = STOVES[0]!;
  const pot = h.tile(stove).pot!;
  const p = h.snap.players[0]!;
  h.face(stove);

  pot.contents = [{ type: 'rice', chopped: false, cooked: false }];
  pot.state = 'cooking';
  p.held = { kind: 'ingredient', ing: chopped('onion') };
  h.a();
  assert.equal(held(h)?.kind, 'ingredient', 'no onions in the rice');

  pot.contents = [chopped('onion')];
  p.held = { kind: 'ingredient', ing: { type: 'rice', chopped: false, cooked: false } };
  h.a();
  assert.equal(held(h)?.kind, 'ingredient', 'and no rice in the soup');
});

test('an unchopped or already-cooked ingredient goes in no pot', () => {
  const h = harness();
  const stove = STOVES[0]!;
  const pot = h.tile(stove).pot!;
  const p = h.snap.players[0]!;
  h.face(stove);

  p.held = { kind: 'ingredient', ing: { type: 'onion', chopped: false, cooked: false } };
  h.a();
  assert.equal(held(h)?.kind, 'ingredient');
  p.held = { kind: 'ingredient', ing: done('onion') };
  h.a();
  assert.equal(held(h)?.kind, 'ingredient');
  assert.equal(pot.contents.length, 0);
});

test('restoreSnapshot round-trips the menu, a plate and a cooked pot', () => {
  const h = harness();
  const stove = STOVES[0]!;
  const counter = COUNTERS[0]!;
  const pot = h.tile(stove).pot!;
  pot.contents = [done('onion'), done('tomato'), done('mushroom')];
  pot.state = 'done';
  h.tile(counter).item = { kind: 'plate', contents: [done('onion')] };

  const wire = JSON.parse(JSON.stringify(h.snap)) as Snapshot;
  const g2 = new Game({ seed: 7, levelId: TEST_LEVEL_ID });
  g2.restoreSnapshot(wire);
  assert.deepEqual(g2.snapshot.dishes, h.snap.dishes);
  const restoredPot = g2.snapshot.tiles[stove]!.pot!;
  assert.deepEqual(partsOf(restoredPot.contents), ['mushroom', 'onion', 'tomato']);
  assert.ok(restoredPot.contents.every((i) => i.cooked));
  const plate = g2.snapshot.tiles[counter]!.item;
  assert.ok(plate?.kind === 'plate' && plate.contents.length === 1);
  // Deep copy, not aliasing.
  plate.contents.push(done('tomato'));
  const source = wire.tiles[counter]!.item;
  assert.ok(source?.kind === 'plate' && source.contents.length === 1);
});

/* ------------------------------ frying pan ------------------------------ */

test('the kitchen has a frying pan and a meat crate', () => {
  assert.equal(PANS.length, 1);
  assert.ok(STOVES.length >= 2);
  assert.ok(LEVEL.tiles.some((t) => t.t === 'crate' && t.crate === 'meat'));
});

test('a pan fries one chopped patty and refuses everything else', () => {
  const h = harness();
  const pan = PANS[0]!;
  const vessel = h.tile(pan).pot!;
  const p = h.snap.players[0]!;
  h.face(pan);

  // Vegetables boil; they have no business in a skillet.
  p.held = { kind: 'ingredient', ing: chopped('onion') };
  h.a();
  assert.equal(held(h)?.kind, 'ingredient', 'a pan does not boil');

  // Raw meat has to be chopped first, exactly like everything else.
  p.held = { kind: 'ingredient', ing: { type: 'meat', chopped: false, cooked: false } };
  h.a();
  assert.equal(held(h)?.kind, 'ingredient', 'an unchopped patty goes nowhere');

  p.held = { kind: 'ingredient', ing: chopped('meat') };
  h.a();
  assert.equal(held(h), null);
  assert.equal(vessel.contents.length, 1);
  assert.equal(vessel.state, 'cooking');

  // Capacity one: a second patty waits its turn.
  p.held = { kind: 'ingredient', ing: chopped('meat') };
  h.a();
  assert.equal(held(h)?.kind, 'ingredient');
  assert.equal(vessel.contents.length, 1);
});

test('a pan cooks in FRY_MS, then burns and ignites like a pot', () => {
  const h = harness();
  const pan = PANS[0]!;
  const vessel = h.tile(pan).pot!;
  vessel.contents = [chopped('meat')];
  vessel.state = 'cooking';

  h.run(FRY_MS * 0.8);
  assert.equal(vessel.state, 'cooking', 'a patty is not done early');
  h.run(FRY_MS * 0.3);
  assert.equal(vessel.state, 'done');
  assert.ok(vessel.contents[0]!.cooked);

  h.run(BURN_MS + TICK_MS);
  assert.equal(vessel.state, 'burnt');
  h.run(FIRE_MS + TICK_MS);
  assert.ok(h.tile(pan).fire, 'char left on a lit ring catches, pan or pot');
});

test('a pan travels like any other cookware', () => {
  const h = harness();
  const pan = PANS[0]!;
  const counter = COUNTERS[0]!;
  h.face(pan);
  h.a();
  const carried = held(h);
  assert.ok(carried?.kind === 'pot' && carried.pot.kind === 'pan');
  assert.equal(h.tile(pan).pot, null, 'the ring is left bare');

  h.face(counter);
  h.a();
  const parked = h.tile(counter).item;
  assert.ok(parked?.kind === 'pot' && parked.pot.kind === 'pan');
  h.a();
  h.face(pan);
  h.a();
  assert.equal(h.tile(pan).pot?.kind, 'pan', 'and the same pan goes back');
});

/* --------------------------- plate assembly ----------------------------- */

/** Which starter-kitchen ingredients need a board before they are usable. */
const INGREDIENTS_NEEDING_KNIFE = new Set<IngredientType>(['cheese', 'meat']);

/** Crate -> board -> chop -> hand: one prepared ingredient, in hand. */
function prep(h: Harness, type: IngredientType): void {
  h.face(crateOf(type));
  h.a();
  h.face(BOARDS[0]!);
  h.a();
  h.holdB(CHOP_MS + TICK_MS * 2);
  h.a();
}

test('chop, fry, plate and serve a burger', () => {
  const h = harness(1, 7, ['burger']);
  const pan = PANS[0]!;
  const counter = COUNTERS[0]!;
  assert.equal(h.snap.orders[0]!.dish, 'burger');

  prep(h, 'meat');
  h.face(pan);
  h.a();
  assert.equal(held(h), null, 'the patty is in the pan');
  h.run(FRY_MS + TICK_MS);
  assert.equal(h.tile(pan).pot!.state, 'done');

  // Park a clean plate, then bring the bun to it.
  h.face(PLATES[0]!);
  h.a();
  h.face(counter);
  h.a();
  h.face(crateOf('bun'));
  h.a();
  h.face(counter);
  h.a();
  const plated = h.tile(counter).item;
  assert.ok(plated?.kind === 'plate' && partsOf(plated.contents).join() === 'bun');
  assert.equal(held(h), null, 'the bun needs no knife and no pan');

  // Carry the plate to the pan and tip the patty onto it.
  h.a();
  h.face(pan);
  h.a();
  const plate = held(h);
  assert.ok(plate?.kind === 'plate');
  assert.deepEqual(partsOf(plate.contents), ['bun', 'meat']);
  assert.equal(h.tile(pan).pot!.state, 'idle', 'the pan is empty again');

  h.face(SERVE[0]!);
  h.a();
  assert.equal(held(h), null);
  assert.equal(h.snap.served, 1);
  assert.ok(h.snap.score > 0);
});

test('a cheeseburger assembles in either order', () => {
  const build = (order: IngredientType[]): number => {
    const h = harness(1, 3, ['cheeseburger']);
    const counter = COUNTERS[0]!;
    h.face(PLATES[0]!);
    h.a();
    h.face(counter);
    h.a();
    for (const type of order) {
      if (type === 'meat') {
        // A patty cannot be carried out of the pan: the plate goes to it.
        prep(h, 'meat');
        h.face(PANS[0]!);
        h.a();
        h.run(FRY_MS + TICK_MS);
        h.face(counter);
        h.a(); // plate in hand
        h.face(PANS[0]!);
        h.a(); // patty onto the plate
        h.face(counter);
        h.a(); // plate back down
        continue;
      }
      if (INGREDIENTS_NEEDING_KNIFE.has(type)) prep(h, type);
      else {
        h.face(crateOf(type));
        h.a();
      }
      h.face(counter);
      h.a();
    }
    const plate = h.tile(counter).item;
    assert.ok(plate?.kind === 'plate');
    assert.deepEqual(partsOf(plate.contents), ['bun', 'cheese', 'meat']);
    h.a();
    h.face(SERVE[0]!);
    h.a();
    return h.snap.served;
  };
  assert.equal(build(['bun', 'meat', 'cheese']), 1);
  assert.equal(build(['cheese', 'bun', 'meat']), 1);
});

test('a plate refuses a part that no dish on the menu wants', () => {
  const h = harness(1, 7, ['burger']);
  const counter = COUNTERS[0]!;
  h.face(PLATES[0]!);
  h.a();
  h.face(counter);
  h.a();

  // Cheese is perfectly prepared, and no burger on this menu has any.
  prep(h, 'cheese');
  h.face(counter);
  h.a();
  assert.equal(held(h)?.kind, 'ingredient', 'the plate will not take it');
  const plate = h.tile(counter).item;
  assert.ok(plate?.kind === 'plate' && plate.contents.length === 0);
});

test('a plate takes no part twice over what the menu allows', () => {
  const h = harness(1, 7, ['burger']);
  const counter = COUNTERS[0]!;
  h.face(PLATES[0]!);
  h.a();
  h.face(counter);
  h.a();
  for (let i = 0; i < 2; i++) {
    h.face(crateOf('bun'));
    h.a();
    h.face(counter);
    h.a();
  }
  assert.equal(held(h)?.kind, 'ingredient', 'a burger has exactly one bun');
  const plate = h.tile(counter).item;
  assert.ok(plate?.kind === 'plate' && plate.contents.length === 1);
});

test('an unfinished part never reaches a plate', () => {
  const h = harness(1, 7, ['burger']);
  const counter = COUNTERS[0]!;
  h.face(PLATES[0]!);
  h.a();
  h.face(counter);
  h.a();
  // Chopped but raw: the pan has not seen it yet.
  h.snap.players[0]!.held = { kind: 'ingredient', ing: chopped('meat') };
  h.face(counter);
  h.a();
  assert.equal(held(h)?.kind, 'ingredient', 'a raw patty is not food');
  const plate = h.tile(counter).item;
  assert.ok(plate?.kind === 'plate' && plate.contents.length === 0);
});

test('a full pot pours onto a clean plate but never onto a burger', () => {
  const h = harness(1, 7, ['burger', 'onion-soup']);
  const stove = STOVES[0]!;
  const counter = COUNTERS[0]!;
  const pot = h.tile(stove).pot!;
  pot.contents = [chopped('onion'), chopped('onion'), chopped('onion')];
  finish(pot);

  // A plate that already holds a bun is on its way to a burger; soup is not
  // part of that plan, and the pour is all-or-nothing.
  h.face(PLATES[0]!);
  h.a();
  h.face(counter);
  h.a();
  h.face(crateOf('bun'));
  h.a();
  h.face(counter);
  h.a();
  h.a(); // pick the plate back up
  h.face(stove);
  h.a();
  const plate = held(h);
  assert.ok(plate?.kind === 'plate' && plate.contents.length === 1);
  assert.equal(pot.state, 'done', 'the soup stays in the pot');

  // A clean plate takes the whole pot in one press.
  h.face(counter);
  h.a();
  h.face(PLATES[0]!);
  h.a();
  h.face(stove);
  h.a();
  const soup = held(h);
  assert.ok(soup?.kind === 'plate');
  assert.deepEqual(partsOf(soup.contents), ['onion', 'onion', 'onion']);
});

test('the pot has exactly as many slots as the biggest boil batch', () => {
  // POT_CAPACITY is the renderer's fill-pip count and the empty pot's
  // capacity, so it has to track the catalogue rather than drift from it.
  const biggest = Math.max(
    ...Object.values(INGREDIENTS).map((d) => (d.cook === 'boil' ? (d.boilBatch ?? 1) : 0)),
  );
  assert.equal(POT_CAPACITY, biggest);
});

/* --------------------------------- pause -------------------------------- */

/**
 * Who paused, by name, or null. A function rather than a field read because
 * `assert.equal` is an assertion signature: comparing `snap.paused` to null
 * would narrow that property to `null` for the rest of the test.
 */
const pausedBy = (h: Harness): string | null => h.snap.paused?.name ?? null;

test('pause freezes every clock in the kitchen, and resume picks them up', () => {
  const h = harness();
  const stove = STOVES[0]!;
  const board = BOARDS[0]!;
  const burning = STOVES[1]!;

  // One of everything with a clock on it: a pot cooking, a chef chopping,
  // a tile alight, an order draining, and the round itself.
  fillPot(h, stove, 'onion');
  h.tile(board).item = { kind: 'ingredient', ing: rawOnion() };
  igniteTile(h, burning);
  h.face(board);
  h.g.press('p0', 'b');
  h.run(600);

  const before = {
    msLeft: h.snap.msLeft,
    order: h.snap.orders[0]!.msLeft,
    cook: h.tile(stove).pot!.cookMs,
    chop: h.tile(board).chopMs,
    fire: h.tile(burning).fire!.ms,
  };

  assert.equal(h.g.pause('p0'), true);
  assert.equal(h.g.paused?.by, 'p0');
  assert.equal(pausedBy(h), 'P0');
  h.run(5000);

  assert.equal(h.snap.msLeft, before.msLeft);
  assert.equal(h.snap.orders[0]!.msLeft, before.order);
  assert.equal(h.tile(stove).pot!.cookMs, before.cook);
  assert.equal(h.tile(board).chopMs, before.chop);
  assert.equal(h.tile(burning).fire!.ms, before.fire);
  // The pause's own clock is the one thing that keeps counting.
  assert.ok(h.snap.paused!.sinceMs >= 5000);

  assert.equal(h.g.resume('p0'), true);
  assert.equal(pausedBy(h), null);
  h.run(600);
  assert.ok(h.snap.msLeft < before.msLeft);
  assert.ok(h.tile(stove).pot!.cookMs > before.cook);
  assert.ok(h.tile(burning).fire!.ms > before.fire);
});

test('a button pressed while paused never fires on resume', () => {
  const h = harness();
  h.g.pause('p0');
  h.face(CRATES[0]!);
  h.a(); // an A press that must be thrown away, not banked
  h.g.resume('p0');
  h.run(TICK_MS * 2);
  assert.equal(held(h), null);
});

test('pause is refused outside a running round, and to strangers', () => {
  const h = harness();
  assert.equal(h.g.pause('nobody'), false);
  assert.equal(pausedBy(h), null);

  assert.equal(h.g.pause('p0'), true);
  assert.equal(h.g.pause('p0'), false, 'already paused');
  assert.equal(h.g.resume('nobody'), false, 'a stranger cannot resume either');
  assert.equal(pausedBy(h), 'P0');
  assert.equal(h.g.resume('p0'), true);
  assert.equal(h.g.resume('p0'), false, 'nothing to resume');

  h.g.toLobby();
  assert.equal(h.g.pause('p0'), false, 'there is no round to stop');
  assert.equal(pausedBy(h), null);
});

test('any chef may resume, including one who did not pause', () => {
  const h = harness(2);
  assert.equal(h.g.pause('p1'), true);
  assert.equal(h.g.paused?.by, 'p1');
  // The chef who paused walks off; the table is not held hostage.
  h.g.removePlayer('p1');
  assert.equal(pausedBy(h), 'P1', 'a disconnect does not resume, and the name stays');
  assert.equal(h.g.resume('p0'), true);
  assert.equal(pausedBy(h), null);
});

test('restoreSnapshot round-trips a paused kitchen', () => {
  const h = harness();
  fillPot(h, STOVES[0]!, 'onion');
  h.run(900);
  h.g.pause('p0');
  h.run(400);

  const wire = JSON.parse(JSON.stringify(h.snap)) as Snapshot;
  const g2 = new Game({ seed: 7, levelId: TEST_LEVEL_ID });
  g2.restoreSnapshot(wire);
  assert.deepEqual(g2.snapshot.paused, wire.paused);

  // Still frozen after the restore: a host reconnect must not start eight
  // chefs running again while they are all looking at their phones.
  const cook = g2.snapshot.tiles[STOVES[0]!]!.pot!.cookMs;
  for (let i = 0; i < 30; i++) g2.tick(TICK_MS);
  assert.equal(g2.snapshot.tiles[STOVES[0]!]!.pot!.cookMs, cook);
  assert.equal(g2.resume('p0'), true);
  for (let i = 0; i < 30; i++) g2.tick(TICK_MS);
  assert.ok(g2.snapshot.tiles[STOVES[0]!]!.pot!.cookMs > cook);
});

test('a fresh round is never paused', () => {
  const h = harness();
  h.g.pause('p0');
  h.g.start();
  assert.equal(pausedBy(h), null);
});

/* ------------------------- delight on a served dish ---------------------- */

/**
 * Serve the queue's first order at a chosen remaining fraction, by winding
 * that ticket's clock to where the test wants it and tipping a matching pot
 * onto a plate. Returns the fx event the serve posted.
 */
function serveAt(h: Harness, frac: number, id = 'p0'): FxEvent {
  const order = h.snap.orders[0]!;
  order.msLeft = order.totalMs * frac;
  const stove = STOVES[0]!;
  const pot = h.tile(stove).pot!;
  pot.contents = order.recipe.map(done);
  pot.state = 'done';
  pot.cookMs = 0;
  h.face(PLATES[0]!, id);
  h.a(id);
  h.face(stove, id);
  h.a(id);
  h.face(SERVE[0]!, id);
  h.a(id);
  const ev = h.snap.fx[h.snap.fx.length - 1];
  assert.ok(ev, 'the serve posted no fx event');
  return ev;
}

test('a serve posts one fx event, tiered by how early it was', () => {
  for (const [frac, tier] of [
    [0.9, 'perfect'],
    [0.5, 'great'],
    [0.1, 'good'],
  ] as const) {
    const h = harness();
    const before = h.snap.score;
    const ev = serveAt(h, frac);
    assert.equal(ev.t, 'serve');
    assert.equal(ev.tier, tier);
    assert.equal(ev.playerId, 'p0');
    assert.equal(ev.dish, h.snap.dishes[0] ?? ev.dish);
    // The points on the event are the points that were scored, to the point.
    assert.equal(ev.points, h.snap.score - before);
    assert.equal(ev.points, SERVE_POINTS + Math.round(SERVE_TIME_BONUS_MAX * frac));
    // It came out of a serve window, at that window's tile.
    const i = ev.tile.y * h.snap.w + ev.tile.x;
    assert.equal(h.tile(i).t, 'serve');
    assert.equal(ev.at, h.snap.elapsedMs);
  }
});

test('a plate nobody ordered is scored and celebrated as nothing', () => {
  const h = harness();
  h.face(PLATES[0]!);
  h.a();
  const plate = held(h);
  assert.ok(plate?.kind === 'plate');
  // Three tomatoes when the ticket wants onions: no order, no points, no fx.
  plate.contents = [done('tomato'), done('tomato'), done('tomato')];
  const score = h.snap.score;
  h.face(SERVE[0]!);
  h.a();
  assert.equal(held(h), null);
  assert.equal(h.snap.score, score);
  assert.equal(h.snap.served, 0);
  assert.equal(h.snap.fx.length, 0);
});

test('three perfect serves in a row is a streak, and anything less breaks it', () => {
  const h = harness();
  const streaks: number[] = [];
  for (const frac of [0.9, 0.9, 0.9, 0.4, 0.9]) {
    // Keep the rail stocked: each serve takes the ticket it matched.
    h.run(ORDER_SPAWN_MS);
    streaks.push(serveAt(h, frac).streak);
  }
  assert.deepEqual(streaks, [1, 2, 3, 0, 1]);
});

test('the fx buffer is short, and forgets what the TV has finished with', () => {
  const h = harness();
  // Serve far more dishes than the buffer holds, back to back: the natural
  // order cadence is slower than the buffer's own lifetime, so the rail is
  // restocked by hand rather than by waiting 15 s a ticket.
  const ticket = h.snap.orders[0]!;
  for (let i = 0; i < FX_MAX + 4; i++) {
    if (h.snap.orders.length === 0) {
      h.snap.orders.push({ ...ticket, id: 1000 + i, recipe: [...ticket.recipe] });
    }
    serveAt(h, 0.5);
    h.run(TICK_MS);
  }
  assert.equal(h.snap.fx.length, FX_MAX);
  // Ids only ever go up, so the survivors are the most recent ones.
  const ids = h.snap.fx.map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));

  h.run(FX_TTL_MS + TICK_MS);
  assert.equal(h.snap.fx.length, 0);
});

test('a serve buzzes harder the better it was', () => {
  const pulses = (frac: number): number => {
    const h = harness();
    const order = h.snap.orders[0]!;
    order.msLeft = order.totalMs * frac;
    const stove = STOVES[0]!;
    const pot = h.tile(stove).pot!;
    pot.contents = order.recipe.map(done);
    pot.state = 'done';
    h.face(PLATES[0]!);
    h.a();
    h.face(stove);
    h.a();
    h.face(SERVE[0]!);
    h.g.press('p0', 'a');
    const events = h.g.tick(TICK_MS);
    const buzz = events[events.length - 1]!.buzzMs;
    // A pattern is buzz, pause, buzz, … so the pulse count is every other step.
    return Array.isArray(buzz) ? Math.ceil(buzz.length / 2) : 1;
  };
  assert.equal(pulses(0.1), 1);
  assert.equal(pulses(0.5), 2);
  assert.equal(pulses(0.9), 3);
});

test('restoreSnapshot round-trips the fx buffer and the round clock', () => {
  const h = harness();
  h.run(2000);
  serveAt(h, 0.9);
  h.run(200);

  const wire = JSON.parse(JSON.stringify(h.snap)) as Snapshot;
  const g2 = new Game({ seed: 7, levelId: TEST_LEVEL_ID });
  g2.restoreSnapshot(wire);
  assert.equal(g2.snapshot.elapsedMs, wire.elapsedMs);
  assert.deepEqual(g2.snapshot.fx, wire.fx);
  // Deep copy, not aliasing.
  g2.snapshot.fx[0]!.points = 999;
  assert.notEqual(wire.fx[0]!.points, 999);
  // And a restored round goes on pruning its own buffer.
  g2.tick(TICK_MS);
  assert.equal(g2.snapshot.fx.length, 1);
  for (let i = 0; i < 200; i++) g2.tick(TICK_MS);
  assert.equal(g2.snapshot.fx.length, 0);
});

test('a fresh round starts with an empty buffer and a zeroed clock', () => {
  const h = harness();
  h.run(1000);
  serveAt(h, 0.9);
  h.g.start();
  assert.equal(h.snap.fx.length, 0);
  assert.equal(h.snap.elapsedMs, 0);
});

/* -------------------------------- taking aim ---------------------------- */

// Aiming is geometry, so these name tiles by coordinate. Home Kitchen 3 is
//
//        0 1 2 3 4 5 6 7 8 9 10 11 12
//     0  # O T M # # # F # S #  S  #
//     1  # . . . . . @ . . . .  .  #
//     2  U . @ . . . . . . . @  .  #
//     3  R . . . # B # # # . .  .  #
//     4  C . . . # # # B # . .  .  #
//     5  # . @ . . . . . . . @  .  #
//     6  # . . . . . @ . . . .  .  P
//     7  # X # # # # # # E # #  W  #
//
// so (5,3) is the north board with a counter either side of it, and (9,0) a
// boiling ring with a counter either side of that.
const at = (x: number, y: number): number => y * LEVEL.w + x;
const BOARD_N = at(5, 3);
const WEST_OF_BOARD = at(4, 3);
const EAST_OF_BOARD = at(6, 3);
const RING_N = at(9, 0);
const WEST_OF_RING = at(8, 0);

test('the kitchen those coordinates describe is the one we cook in', () => {
  assert.equal(LEVEL.tiles[BOARD_N]!.t, 'board');
  assert.equal(LEVEL.tiles[WEST_OF_BOARD]!.t, 'counter');
  assert.equal(LEVEL.tiles[EAST_OF_BOARD]!.t, 'counter');
  assert.equal(LEVEL.tiles[RING_N]!.pot?.kind, 'pot');
  assert.equal(LEVEL.tiles[WEST_OF_RING]!.t, 'counter');
  for (const [x, y] of [
    [5, 2],
    [4, 2],
    [9, 1],
  ] as const) {
    assert.equal(LEVEL.tiles[at(x, y)]!.t, 'floor', `(${x},${y}) is where a chef stands`);
  }
});

/** Stand a chef exactly here, facing exactly there, and let the sim aim once. */
function aim(h: Harness, x: number, y: number, dx: number, dy: number, id = 'p0'): number | null {
  const p = h.snap.players.find((q) => q.id === id)!;
  p.pos = { x, y };
  const len = Math.hypot(dx, dy);
  p.dir = { x: dx / len, y: dy / len };
  h.tick(TICK_MS);
  return p.target;
}

test('the aim never lands on a patch of floor', () => {
  const h = harness();
  // `round(pos + dir)` used to answer "the floor tile to my right" here, and a
  // press on floor is a press that silently does nothing — the whole complaint.
  assert.equal(aim(h, 5, 2, 1, 0), EAST_OF_BOARD);
  assert.notEqual(h.tile(EAST_OF_BOARD).t, 'floor');
});

test('leaning at a station from the corner is a press that lands', () => {
  const h = harness();
  h.face(CRATES[0]!);
  h.a();
  assert.equal(held(h)?.kind, 'ingredient');
  // Beside the island, mostly facing along it and a little into it.
  assert.equal(aim(h, 4, 2, 0.9, 0.44), BOARD_N);
  h.a();
  assert.equal(held(h), null);
  assert.equal(h.tile(BOARD_N).item?.kind, 'ingredient');
});

test('a wobbling thumb does not move the target, a turn does', () => {
  const h = harness();
  // Pointed between the board and the counter east of it, board ahead.
  assert.equal(aim(h, 5, 2, Math.cos(1.187), Math.sin(1.187)), BOARD_N);
  // Eight degrees the other way: the counter now scores a hair higher, and
  // the aim stays where the chef put it.
  assert.equal(aim(h, 5, 2, Math.cos(1.047), Math.sin(1.047)), BOARD_N);
  // A deliberate turn is not a wobble.
  assert.equal(aim(h, 5, 2, 1, 1), EAST_OF_BOARD);
});

test('you get the station you lean at, not the one beside it', () => {
  const h = harness();
  assert.equal(aim(h, 9, 1, 0, -1), RING_N);
  assert.equal(aim(h, 9, 1, -1, -1), WEST_OF_RING);
  assert.equal(aim(h, 9, 1, 0, -1), RING_N);
});

test('a chef facing an empty room aims at nothing at all', () => {
  const h = harness();
  assert.equal(aim(h, 5, 2, 0, 1), BOARD_N);
  assert.equal(aim(h, 5, 2, 0, -1), null, 'three floor tiles are not a station');
  h.a();
  assert.equal(held(h), null, 'and a press on nothing is a press on nothing');
});

test('what is in your hands settles two stations at the same angle', () => {
  const h = harness();
  h.tile(WEST_OF_BOARD).item = { kind: 'ingredient', ing: rawOnion() };
  // Empty-handed, the loaded counter wins: it is the one with something on it.
  assert.equal(aim(h, 4, 2, Math.cos(1.134), Math.sin(1.134)), WEST_OF_BOARD);
  // Carrying an onion, that counter has nothing left to offer and the empty
  // board beside it does.
  h.snap.players[0]!.held = { kind: 'ingredient', ing: rawOnion() };
  assert.equal(aim(h, 4, 2, Math.cos(1.134), Math.sin(1.134)), BOARD_N);
});

test('a fire pulls the aim only once you are carrying the answer', () => {
  const h = harness();
  igniteTile(h, WEST_OF_BOARD);
  h.tile(BOARD_N).item = { kind: 'ingredient', ing: rawOnion() };
  // Bare hands can do nothing about a fire, so the aim offers the board.
  assert.equal(aim(h, 4, 2, Math.cos(1.134), Math.sin(1.134)), BOARD_N);
  h.snap.players[0]!.held = { kind: 'extinguisher' };
  assert.equal(aim(h, 4, 2, Math.cos(1.134), Math.sin(1.134)), WEST_OF_BOARD);
});

test('standing still, a chef squares up with what they are aiming at', () => {
  const h = harness();
  const p = h.snap.players[0]!;
  assert.equal(aim(h, 5, 2, 0.25, 0.97), BOARD_N);
  h.run(400);
  assert.equal(p.target, BOARD_N);
  assert.ok(p.dir.y > 0.999, `eased onto the board, not ${JSON.stringify(p.dir)}`);
  // The stick always wins: push it and the facing is the stick's again.
  h.g.setMove('p0', { x: 1, y: 0 });
  h.run(200);
  assert.ok(p.dir.x > 0.999);
});

test('the snapshot says which tile each press will land on', () => {
  const h = harness();
  h.face(BOARDS[0]!);
  h.tick(TICK_MS);
  assert.equal(h.snap.players[0]!.target, BOARDS[0]);

  // A resumed host has to highlight the right counter on its first frame.
  const wire = JSON.parse(JSON.stringify(h.snap)) as Snapshot;
  const g2 = new Game({ seed: 7, levelId: TEST_LEVEL_ID });
  g2.restoreSnapshot(wire);
  assert.equal(g2.snapshot.players[0]!.target, BOARDS[0]);

  // Junk off the wire is not a tile index.
  const junk = JSON.parse(JSON.stringify(h.snap)) as Snapshot;
  (junk.players[0] as { target: unknown }).target = 99999;
  g2.restoreSnapshot(junk);
  assert.equal(g2.snapshot.players[0]!.target, null);
});

/* -------------------------- A knows what it is for ----------------------- */

test('A is the knife when your hands are empty at a board', () => {
  const h = harness();
  const board = BOARDS[0]!;
  h.face(CRATES[0]!);
  h.a();
  h.face(board);
  h.a();
  assert.equal(h.tile(board).item?.kind, 'ingredient');

  h.g.press('p0', 'a');
  h.run(CHOP_MS * 0.4);
  assert.equal(h.snap.players[0]!.chopping, true, 'holding A chops');
  assert.equal(held(h), null, 'and never snatches the raw ingredient back');
  h.run(CHOP_MS * 0.7);
  const sliced = h.tile(board).item;
  assert.ok(sliced?.kind === 'ingredient' && sliced.ing.chopped);
  h.g.release('p0', 'a');
  h.tick(TICK_MS);

  // Chopped, the same button is a pickup again.
  h.a();
  assert.equal(held(h)?.kind, 'ingredient');
  assert.equal(h.tile(board).item, null);
});

test('the knife only comes out for something that wants chopping', () => {
  const h = harness();
  const board = BOARDS[0]!;
  // A bun takes no knife (the catalogue says so), so A picks it straight up.
  h.face(crateOf('bun'));
  h.a();
  h.face(board);
  h.a();
  h.holdA(CHOP_MS + TICK_MS * 2);
  assert.equal(held(h)?.kind, 'ingredient', 'the bun came back to hand at once');
  assert.equal(h.tile(board).item, null);
  assert.equal(h.tile(board).chopMs ?? 0, 0, 'and nothing was chopped');
});

test('with something in hand, A is the table again and B is still the knife', () => {
  const h = harness();
  const board = BOARDS[0]!;
  h.tile(board).item = { kind: 'ingredient', ing: rawOnion() };
  h.face(crateOf('tomato'));
  h.a();
  h.face(board);
  h.holdA(CHOP_MS + TICK_MS * 2);
  assert.equal(held(h)?.kind, 'ingredient', 'a full hand still holds its tomato');
  const raw = h.tile(board).item;
  assert.ok(raw?.kind === 'ingredient' && !raw.ing.chopped, 'and A did not chop for it');

  h.holdB(CHOP_MS + TICK_MS * 2);
  const sliced = h.tile(board).item;
  assert.ok(sliced?.kind === 'ingredient' && sliced.ing.chopped, 'B chops with a full hand');
});

test('one chef leaning on both buttons is not two chefs', () => {
  const h = harness();
  const board = BOARDS[0]!;
  h.tile(board).item = { kind: 'ingredient', ing: rawOnion() };
  h.face(board);
  h.g.press('p0', 'a');
  h.g.press('p0', 'b');
  h.run(CHOP_MS * 0.6);
  const item = h.tile(board).item;
  assert.ok(item?.kind === 'ingredient' && !item.ing.chopped);
});

/* ------------------- the aim's mirror of the action table ---------------- */

/**
 * `Game.affords` is private on purpose: it is an internal mirror of the
 * Button A table that the aim uses to break near-ties. Reaching in is exactly
 * what the test below is for — it is what keeps the mirror honest.
 */
const affordsAt = (h: Harness, idx: number): boolean =>
  (h.g as unknown as { affords(t: Tile, item: HeldItem | null): boolean }).affords(
    h.tile(idx),
    held(h),
  );

/** Everything one press could change about a tile, as a comparable string. */
const outcome = (h: Harness, idx: number): string =>
  JSON.stringify({
    tile: h.tile(idx),
    held: held(h),
    score: h.snap.score,
    served: h.snap.served,
    orders: h.snap.orders.length,
  });

const vessel = (state: Pot['state'], contents: Ingredient[] = []): Pot => ({
  kind: 'pot',
  contents,
  cookMs: 0,
  state,
});

const soup = (): Ingredient[] => [done('onion'), done('onion'), done('onion')];

interface Station {
  name: string;
  idx: number;
  /** A tile that is alight: A refuses every one of those, foam does not. */
  burning?: boolean;
  set?: (h: Harness) => void;
}

const STATIONS: Station[] = [
  { name: 'a crate', idx: crateOf('onion') },
  { name: 'the plate stack', idx: PLATES[0]! },
  { name: 'the serve window', idx: SERVE[0]! },
  { name: 'the bin', idx: TRASH[0]! },
  { name: 'a stocked bracket', idx: MOUNT },
  { name: 'an empty bracket', idx: MOUNT, set: (h) => void (h.tile(MOUNT).item = null) },
  { name: 'an empty counter', idx: COUNTERS[0]! },
  {
    name: 'a counter holding a raw onion',
    idx: COUNTERS[0]!,
    set: (h) => void (h.tile(COUNTERS[0]!).item = { kind: 'ingredient', ing: rawOnion() }),
  },
  {
    name: 'a counter holding a ready onion',
    idx: COUNTERS[0]!,
    set: (h) => void (h.tile(COUNTERS[0]!).item = { kind: 'ingredient', ing: done('onion') }),
  },
  {
    name: 'a counter holding a clean plate',
    idx: COUNTERS[0]!,
    set: (h) => void (h.tile(COUNTERS[0]!).item = { kind: 'plate', contents: [] }),
  },
  {
    name: 'a counter holding a part-built plate',
    idx: COUNTERS[0]!,
    set: (h) => void (h.tile(COUNTERS[0]!).item = { kind: 'plate', contents: [done('onion')] }),
  },
  {
    name: 'a counter holding an idle pot',
    idx: COUNTERS[0]!,
    set: (h) => void (h.tile(COUNTERS[0]!).item = { kind: 'pot', pot: vessel('idle') }),
  },
  {
    name: 'a counter holding a finished pot',
    idx: COUNTERS[0]!,
    set: (h) => void (h.tile(COUNTERS[0]!).item = { kind: 'pot', pot: vessel('done', soup()) }),
  },
  {
    name: 'a counter holding a burnt pot',
    idx: COUNTERS[0]!,
    set: (h) => void (h.tile(COUNTERS[0]!).item = { kind: 'pot', pot: vessel('burnt', soup()) }),
  },
  { name: 'an empty board', idx: BOARDS[0]! },
  {
    name: 'a board holding a raw onion',
    idx: BOARDS[0]!,
    set: (h) => void (h.tile(BOARDS[0]!).item = { kind: 'ingredient', ing: rawOnion() }),
  },
  {
    name: 'a board holding a chopped onion',
    idx: BOARDS[0]!,
    set: (h) => void (h.tile(BOARDS[0]!).item = { kind: 'ingredient', ing: chopped('onion') }),
  },
  {
    name: 'a board holding a bun',
    idx: BOARDS[0]!,
    set: (h) =>
      void (h.tile(BOARDS[0]!).item = {
        kind: 'ingredient',
        ing: { type: 'bun', chopped: false, cooked: false },
      }),
  },
  { name: 'a ring with an idle pot', idx: STOVES[0]! },
  { name: 'a ring with a cooking pot', idx: STOVES[0]!, set: (h) => fillPot(h, STOVES[0]!) },
  { name: 'a ring with a finished pot', idx: STOVES[0]!, set: (h) => finish(h.tile(STOVES[0]!).pot!) },
  {
    name: 'a ring with a burnt pot',
    idx: STOVES[0]!,
    set: (h) => {
      const p = h.tile(STOVES[0]!).pot!;
      p.contents = soup();
      p.state = 'burnt';
    },
  },
  { name: 'a bare ring', idx: STOVES[0]!, set: (h) => void (h.tile(STOVES[0]!).pot = null) },
  { name: 'a frying ring', idx: PANS[0]! },
  {
    name: 'a burning counter',
    idx: COUNTERS[0]!,
    burning: true,
    set: (h) => igniteTile(h, COUNTERS[0]!),
  },
];

const HANDS: { name: string; take: () => HeldItem | null }[] = [
  { name: 'empty-handed', take: () => null },
  { name: 'a raw onion', take: () => ({ kind: 'ingredient', ing: rawOnion() }) },
  { name: 'a chopped onion', take: () => ({ kind: 'ingredient', ing: chopped('onion') }) },
  { name: 'a ready onion', take: () => ({ kind: 'ingredient', ing: done('onion') }) },
  { name: 'a chopped patty', take: () => ({ kind: 'ingredient', ing: chopped('meat') }) },
  { name: 'a clean plate', take: () => ({ kind: 'plate', contents: [] }) },
  { name: 'a plate of soup', take: () => ({ kind: 'plate', contents: soup() }) },
  { name: 'an empty pot', take: () => ({ kind: 'pot', pot: vessel('idle') }) },
  { name: 'a finished pot', take: () => ({ kind: 'pot', pot: vessel('done', soup()) }) },
  { name: 'the extinguisher', take: () => ({ kind: 'extinguisher' }) },
];

test('the aim only ever promises what a press can deliver', () => {
  for (const station of STATIONS) {
    for (const hand of HANDS) {
      const build = (): Harness => {
        const h = harness(1, 7, ['onion-soup']);
        station.set?.(h);
        h.snap.players[0]!.held = hand.take();
        h.face(station.idx);
        return h;
      };
      const where = `${hand.name} at ${station.name}`;

      // The same kitchen twice, one press apart. Whatever differs is the
      // press, so nothing that merely ticked can be mistaken for one.
      const idle = build();
      idle.tick(TICK_MS);
      const acting = build();
      const promised = affordsAt(acting, station.idx);
      acting.g.press('p0', 'a');
      acting.tick(TICK_MS);
      acting.g.release('p0', 'a');

      assert.equal(acting.snap.players[0]!.target, station.idx, `aimed elsewhere: ${where}`);
      if (station.burning) {
        // Flames refuse every press; the mirror's one non-A row is the foam.
        assert.equal(outcome(acting, station.idx), outcome(idle, station.idx), where);
        assert.equal(promised, hand.name === 'the extinguisher', where);
        continue;
      }
      assert.equal(outcome(acting, station.idx) !== outcome(idle, station.idx), promised, where);
    }
  }
});
