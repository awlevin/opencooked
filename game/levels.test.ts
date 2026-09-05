// Every level, cooked.
//
// `shared/levels.test.ts` proves a kitchen parses; this file proves one can be
// played: for each of the nine levels a single chef is walked (well —
// teleported: pathing is not what this is about) through a real ticket, doing
// exactly what the level's own menu demands, and the ticket has to come back
// as a serve. A level that cannot serve its own first order is broken, however
// pretty its map is.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DISHES, INGREDIENTS, boilBatchOf } from '../shared/catalogue';
import type { IngredientType } from '../shared/catalogue';
import { DEFAULT_LEVEL_ID, LEVELS, createLevel, nextLevelId } from '../shared/levels';
import type { Level } from '../shared/levels';
import type { Snapshot, Vec2 } from '../shared/types';
import { CHOP_MS, COOK_MS, FRY_MS, TICK_MS } from '../shared/types';
import { Game } from './game';

/** Where to stand, and which way to face, to work the station at `idx`. */
function accessOf(level: Level, idx: number): { stand: Vec2; dir: Vec2 } {
  const x = idx % level.w;
  const y = Math.floor(idx / level.w);
  for (const d of [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]) {
    const sx = x - d.x;
    const sy = y - d.y;
    if (sx < 0 || sy < 0 || sx >= level.w || sy >= level.h) continue;
    if (level.tiles[sy * level.w + sx]!.t !== 'floor') continue;
    return { stand: { x: sx, y: sy }, dir: d };
  }
  throw new Error(`no access to tile ${idx}`);
}

/** One chef, one kitchen, and the shortest possible way to drive them. */
class Chef {
  readonly g: Game;
  readonly snap: Snapshot;
  readonly level: Level;

  constructor(levelId: string) {
    this.level = createLevel(levelId);
    this.g = new Game({ seed: 5, levelId });
    this.g.addPlayer('p0', 'Chef', '#fff');
    this.g.start();
    this.snap = this.g.snapshot;
  }

  private get me() {
    return this.snap.players[0]!;
  }

  /** Every tile index of one type, in reading order. */
  indices(pick: (i: number) => boolean): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.level.tiles.length; i++) if (pick(i)) out.push(i);
    return out;
  }

  face(idx: number): void {
    const { stand, dir } = accessOf(this.level, idx);
    this.me.pos = { x: stand.x, y: stand.y };
    this.me.dir = { x: dir.x, y: dir.y };
  }

  a(): void {
    this.g.press('p0', 'a');
    this.g.tick(TICK_MS);
  }

  run(ms: number): void {
    let left = ms;
    while (left > 0) {
      const step = Math.min(TICK_MS, left);
      this.g.tick(step);
      left -= step;
    }
  }

  holdB(ms: number): void {
    this.g.press('p0', 'b');
    this.run(ms);
    this.g.release('p0', 'b');
    this.g.tick(TICK_MS);
  }

  /** Take a raw part from its crate and give it every prep it asks for. */
  fetch(type: IngredientType, board: number): void {
    const crate = this.indices((i) => this.snap.tiles[i]!.crate === type)[0];
    assert.ok(crate !== undefined, `no ${type} crate`);
    this.face(crate);
    this.a();
    if (!INGREDIENTS[type].chop) return;
    this.face(board);
    this.a(); // put it on the board
    this.holdB(CHOP_MS + TICK_MS * 2);
    this.a(); // pick the chopped part back up
    const held = this.me.held;
    assert.ok(held?.kind === 'ingredient' && held.ing.chopped, `${type} was not chopped`);
  }
}

/**
 * Cook the level's first ticket and run it to the window. The route is derived
 * from the catalogue, not hard-coded: parts that boil go through a pot, the
 * patty goes through a pan, everything else goes straight onto the plate.
 */
function serveFirstOrder(levelId: string): Chef {
  const c = new Chef(levelId);
  const order = c.snap.orders[0];
  assert.ok(order, `${levelId}: a round must open with a ticket`);

  const board = c.indices((i) => c.snap.tiles[i]!.t === 'board')[0]!;
  const pot = c.indices((i) => c.snap.tiles[i]!.pot?.kind === 'pot')[0];
  const pan = c.indices((i) => c.snap.tiles[i]!.pot?.kind === 'pan')[0];
  const plates = c.indices((i) => c.snap.tiles[i]!.t === 'plates')[0]!;
  const serve = c.indices((i) => c.snap.tiles[i]!.t === 'serve')[0]!;
  // A counter with somewhere to stand: the plate waits here while the chef
  // fetches the next part, exactly as a real player would leave it.
  const bench = c.indices((i) => {
    if (c.snap.tiles[i]!.t !== 'counter') return false;
    try {
      accessOf(c.level, i);
      return true;
    } catch {
      return false;
    }
  })[0]!;

  const parts = [...order.recipe];
  const boiled = parts.filter((p) => INGREDIENTS[p].cook === 'boil');
  const fried = parts.filter((p) => INGREDIENTS[p].cook === 'fry');
  const raw = parts.filter((p) => INGREDIENTS[p].cook === null);

  // The plate goes on a counter first; every part joins it there.
  c.face(plates);
  c.a();
  c.face(bench);
  c.a();

  for (const type of raw) {
    c.fetch(type, board);
    c.face(bench);
    c.a();
  }

  /** Fill a vessel, cook it, and tip it onto the waiting plate. */
  const cookThrough = (types: IngredientType[], vessel: number, ms: number): void => {
    for (const type of types) {
      c.fetch(type, board);
      c.face(vessel);
      c.a();
    }
    c.run(ms + TICK_MS * 2);
    assert.equal(c.snap.tiles[vessel]!.pot?.state, 'done', `${levelId}: vessel never finished`);
    c.face(bench);
    c.a(); // pick the plate up
    c.face(vessel);
    c.a(); // tip the batch onto it
    c.face(bench);
    c.a(); // and put it back down
  };

  if (boiled.length > 0) {
    assert.ok(pot !== undefined, `${levelId}: needs a pot`);
    // A pot cooks one batch: the level's menu must ask for exactly that many.
    assert.equal(boiled.length, boilBatchOf(boiled[0]!), `${levelId}: partial batch`);
    cookThrough(boiled, pot, COOK_MS);
  }
  if (fried.length > 0) {
    assert.ok(pan !== undefined, `${levelId}: needs a pan`);
    for (const type of fried) cookThrough([type], pan, FRY_MS);
  }

  c.face(bench);
  c.a();
  c.face(serve);
  c.a();
  return c;
}

for (const def of LEVELS) {
  test(`${def.id} serves its first order`, () => {
    const dish = DISHES[def.menu[0]!];
    assert.ok(dish, `${def.id}: menu[0]`);
    const c = serveFirstOrder(def.id);
    assert.equal(c.snap.served, 1, `${def.id}: nothing was served`);
    assert.ok(c.snap.score > 0, `${def.id}: serving scored nothing`);
    assert.equal(c.snap.players[0]!.held, null, `${def.id}: the plate never left the chef`);
  });
}

test('starting a round can switch the kitchen', () => {
  const g = new Game({ seed: 1 });
  assert.equal(g.levelId, DEFAULT_LEVEL_ID);
  g.addPlayer('p0', 'Chef', '#fff');

  const target = LEVELS.find((l) => l.id === 'sushi-1')!;
  g.start(target.id);
  assert.equal(g.levelId, target.id);
  assert.equal(g.snapshot.worldId, 'sushi');
  assert.deepEqual(g.snapshot.dishes, [...target.menu]);
  // Every chef is stood back on a spawn of the new kitchen.
  const level = createLevel(target.id);
  const spawn = g.snapshot.players[0]!.pos;
  assert.ok(level.spawns.some((s) => s.x === spawn.x && s.y === spawn.y));

  // Per-level tuning travels with the level.
  const omakase = createLevel('sushi-3');
  g.toLobby('sushi-3');
  g.start();
  assert.equal(g.snapshot.orders[0]!.totalMs, omakase.orderMs);

  // Junk off the wire keeps the kitchen we are in.
  g.start('nope');
  assert.equal(g.levelId, 'sushi-3');
});

test('the level survives restoreSnapshot', () => {
  const a = new Game({ seed: 1, levelId: 'grill-2' });
  a.addPlayer('p0', 'Chef', '#fff');
  a.start();
  a.tick(1000);

  const wire = JSON.parse(JSON.stringify(a.snapshot)) as Snapshot;
  assert.equal(wire.levelId, 'grill-2');

  // A host that reconnects starts from the default level and has to land on
  // the level the round is actually being played on — menu, clock and all.
  const b = new Game({ seed: 2 });
  assert.equal(b.levelId, DEFAULT_LEVEL_ID);
  b.restoreSnapshot(wire);
  assert.equal(b.levelId, 'grill-2');
  assert.equal(b.snapshot.worldId, 'grill');
  assert.deepEqual(b.snapshot.dishes, [...createLevel('grill-2').menu]);
  assert.equal(b.snapshot.w, wire.w);
  assert.equal(b.snapshot.h, wire.h);

  // A checkpoint from an older build names no level: stay where we are.
  const legacy = { ...wire, levelId: 'nope' };
  const cGame = new Game({ seed: 3, levelId: 'home-2' });
  cGame.restoreSnapshot(legacy);
  assert.equal(cGame.levelId, 'home-2');
});

test('the run has nine levels across three worlds', () => {
  assert.equal(LEVELS.length, 9);
  assert.equal(new Set(LEVELS.map((l) => l.id.split('-')[0])).size, 3);
  assert.equal(nextLevelId(LEVELS[8]!.id), null);
});
