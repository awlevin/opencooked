// Every level we ship, parsed and checked.
//
// A level is data, and data cannot be reviewed by reading it: this file is the
// gate that says a kitchen is playable at all. Anything that fails here would
// otherwise fail on a TV in front of eight people.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DISHES, INGREDIENTS } from './catalogue';
import type { Tile } from './types';
import { MAX_PLAYERS } from './types';
import type { LevelDef } from './levels';
import {
  DEFAULT_LEVEL_ID,
  LEVELS,
  WORLDS,
  createLevel,
  isLevelId,
  levelById,
  nextLevelId,
  parseLevel,
  themeOf,
  worldOf,
} from './levels';
import { menuLine, mixHex, shade, stationColor } from './levels/minimap';

const ids = LEVELS.map((l) => l.id);

test('every level parses, and its geometry is playable', () => {
  for (const def of LEVELS) {
    const level = levelById(def.id);
    assert.equal(level.tiles.length, level.w * level.h, `${def.id}: tile count`);
    assert.ok(level.spawns.length >= 6, `${def.id}: spawns`);
    for (const s of level.spawns) {
      assert.equal(level.tiles[s.y * level.w + s.x]!.t, 'floor', `${def.id}: spawn on floor`);
    }
    // Round-robin seating means the ninth chef would reuse a spawn, never miss one.
    assert.ok(level.spawns.length <= MAX_PLAYERS, `${def.id}: more spawns than players`);
  }
});

test('every level can cook every dish on its own menu', () => {
  for (const def of LEVELS) {
    const level = levelById(def.id);
    assert.ok(level.menu.length > 0, `${def.id}: empty menu`);
    const crates = new Set<string>();
    let boards = 0;
    let pots = 0;
    let pans = 0;
    for (const tile of level.tiles as Tile[]) {
      if (tile.t === 'crate' && tile.crate) crates.add(tile.crate);
      if (tile.t === 'board') boards++;
      if (tile.t === 'stove') tile.pot?.kind === 'pan' ? pans++ : pots++;
    }
    for (const id of level.menu) {
      for (const part of DISHES[id].parts) {
        const def2 = INGREDIENTS[part];
        assert.ok(crates.has(part), `${def.id}: ${DISHES[id].name} needs a ${def2.label} crate`);
        if (def2.chop) assert.ok(boards > 0, `${def.id}: needs a board`);
        if (def2.cook === 'boil') assert.ok(pots > 0, `${def.id}: needs a pot`);
        if (def2.cook === 'fry') assert.ok(pans > 0, `${def.id}: needs a pan`);
      }
    }
  }
});

test('two calls for one level share nothing', () => {
  const a = createLevel(DEFAULT_LEVEL_ID);
  const b = createLevel(DEFAULT_LEVEL_ID);
  const stove = a.tiles.findIndex((t) => t.t === 'stove');
  assert.ok(stove >= 0);
  a.tiles[stove]!.pot!.state = 'burnt';
  a.spawns[0]!.x = 99;
  assert.equal(b.tiles[stove]!.pot!.state, 'idle');
  assert.notEqual(b.spawns[0]!.x, 99);
});

test('level ids are unique, and every one names a world', () => {
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.ok(isLevelId(id));
    const world = worldOf(id);
    assert.ok(world, `${id}: no world`);
    assert.ok(id.startsWith(`${world.id}-`), `${id}: id does not name its world`);
  }
});

test('unknown level ids are rejected', () => {
  for (const junk of ['', 'nope', 'home-9', 'HOME-1', 42, null, undefined, {}]) {
    assert.equal(isLevelId(junk), false, `${String(junk)} must not be a level id`);
  }
  assert.throws(() => levelById('nope'), /unknown level id/);
  // `createLevel` is the forgiving door: anything off the wire lands on the
  // default level rather than killing the round.
  assert.equal(createLevel('nope').id, DEFAULT_LEVEL_ID);
  assert.equal(createLevel().id, DEFAULT_LEVEL_ID);
});

test('the levels form one run, ending on the last one', () => {
  assert.equal(DEFAULT_LEVEL_ID, ids[0]);
  let id: string | null = DEFAULT_LEVEL_ID;
  const walked: string[] = [];
  while (id !== null) {
    walked.push(id);
    id = nextLevelId(id);
  }
  assert.deepEqual(walked, ids);
  assert.equal(nextLevelId(ids[ids.length - 1]!), null);
  assert.equal(nextLevelId('nope'), null);
});

test('every world has a full theme and its own look', () => {
  const motifs = new Set<string>();
  const accents = new Set<string>();
  for (const world of WORLDS) {
    const theme = world.theme;
    assert.equal(themeOf(world.id), theme);
    for (const [key, value] of Object.entries(theme)) {
      if (key === 'assets') continue;
      assert.equal(typeof value, 'string', `${world.id}: theme.${key}`);
      assert.ok((value as string).length > 0, `${world.id}: theme.${key} is empty`);
    }
    assert.ok(world.levels.length > 0, `${world.id}: no levels`);
    motifs.add(theme.motif);
    accents.add(theme.accent);
  }
  // A world that looks like another world is not a world.
  assert.equal(motifs.size, WORLDS.length);
  assert.equal(accents.size, WORLDS.length);
  assert.equal(themeOf('nope'), WORLDS[0]!.theme);
});

test('a level with a broken map refuses to parse', () => {
  const rows = ['#OBS##', '#....#', '#@@@@#', '#@@@@#', '#XPWE#'];
  const ok: LevelDef = { id: 'test-1', name: 'Ok', rows, menu: ['onion-soup'] };
  /** Parse a one-level throwaway world, so each failure is a one-liner below. */
  const parse = (patch: Partial<LevelDef>): void => {
    const def = { ...ok, ...patch };
    const world = { id: 'test', name: 'Test', tagline: '', theme: WORLDS[0]!.theme, levels: [def] };
    parseLevel(def, world);
  };

  assert.doesNotThrow(() => parse({}));
  assert.throws(() => parse({ rows: ['#OBS##', '#...#', '#@@@@#', '#@@@@#', '#XPWE#'] }), /width/);
  assert.throws(() => parse({ rows: ['#OBS##', '#.Z..#', '#@@@@#', '#@@@@#', '#XPWE#'] }), /unknown tile/);
  assert.throws(() => parse({ rows: ['#OBS##', '#....#', '#@@..#', '#@@..#', '#XPWE#'] }), /spawns/);
  assert.throws(() => parse({ menu: ['burger'] }), /Bun crate/);
  assert.throws(() => parse({ menu: [] }), /at least one dish/);
  assert.throws(() => parse({ orderMs: -1 }), /positive/);
  // A crate walled off from the room is a kitchen nobody can cook in.
  assert.throws(
    () => parse({ rows: ['#OBS##', '######', '#@@@@#', '#@@@@#', '#XPWE#'] }),
    /cannot be reached/,
  );
  // No trash: nowhere to bin a mistake.
  assert.throws(() => parse({ rows: ['#OBS##', '#....#', '#@@@@#', '#@@@@#', '##PWE#'] }), /no trash/);
});

test('the preview names a level by its menu and colours it by its stations', () => {
  // The preview is drawn on a canvas, but everything it decides is pure: the
  // colours and the menu line are checkable without one.
  const level = levelById('home-3');
  const theme = themeOf(level.worldId);

  assert.equal(menuLine(levelById('home-1')), 'Onion Soup');
  // Long menus name three dishes and count the rest.
  assert.match(menuLine(level), /^Onion Soup · .+ \+\d+ more$/);

  const of = (t: Tile['t']): string => {
    const tile = level.tiles.find((x) => x.t === t);
    assert.ok(tile, `home-3 has a ${t}`);
    return stationColor(tile, theme);
  };
  // A crate wears its ingredient; the pass wears the world's accent.
  const onion = level.tiles.find((t) => t.t === 'crate' && t.crate === 'onion')!;
  assert.equal(stationColor(onion, theme), INGREDIENTS.onion.color);
  assert.equal(of('serve'), theme.accent);
  assert.notEqual(of('stove'), of('board'));
  assert.notEqual(of('counter'), of('stove'));

  assert.equal(mixHex('#000000', '#ffffff', 0.5), 'rgb(128, 128, 128)');
  assert.equal(shade('#ffffff', 1), 'rgb(0, 0, 0)');
});
