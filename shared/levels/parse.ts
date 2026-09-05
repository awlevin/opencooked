// ASCII -> tiles, plus every check that stops an unplayable level shipping.
//
// Coordinate convention (matches SPEC "target tile = round(pos + dir)"):
// integer coordinates are TILE CENTRES. Tile (i, j) covers the box
// [i - 0.5, i + 0.5] x [j - 0.5, j + 0.5]. Tiles are stored row-major, so
// tile (x, y) lives at index y * w + x.
//
// Everything here throws rather than repairs. A level is authored once and
// then played thousands of times, so a typo must fail loudly at import — in a
// test, in CI, in a dev server's first request — and never as an order nobody
// can fill ticking down to −10 on the TV.

import type { DishId, IngredientType, KitchenCapabilities } from '../catalogue';
import { assertMenuMakeable } from '../catalogue';
import type { Tile, Vec2 } from '../types';
import { MAX_ORDERS, ORDER_MS, ORDER_SPAWN_MS, ROUND_MS } from '../types';
import type { LevelDef, WorldDef } from './types';

/** A level, parsed and ready to play. Every object in here is freshly made. */
export interface Level {
  id: string;
  name: string;
  worldId: string;
  worldName: string;
  /** 1-based position of this level inside its world, and the world's size. */
  index: number;
  count: number;

  w: number;
  h: number;
  tiles: Tile[];
  spawns: Vec2[];

  menu: DishId[];
  roundMs: number;
  orderMs: number;
  orderSpawnMs: number;
  maxOrders: number;
}

/**
 * ASCII source of truth for a kitchen.
 *
 *   .  floor           @  floor + player spawn
 *   #  plain counter   B  cutting board
 *   S  stove (pot)     F  stove (frying pan)
 *   P  plate stack     W  serve window      X  trash
 *   E  extinguisher mount
 *
 * Crates (one raw ingredient each):
 *   O  onion    T  tomato   M  mushroom    L  lettuce   C  cheese
 *   U  bun      R  raw meat I  rice        H  fish      V  seaweed (nori)
 */
const CRATE_OF: Readonly<Record<string, IngredientType>> = {
  O: 'onion',
  T: 'tomato',
  M: 'mushroom',
  L: 'lettuce',
  C: 'cheese',
  U: 'bun',
  R: 'meat',
  I: 'rice',
  H: 'fish',
  V: 'seaweed',
};

/** Chefs are seated round-robin, so a level needs a spawn for a full house. */
const MIN_SPAWNS = 6;

function tileFromChar(ch: string): Tile {
  switch (ch) {
    case '.':
    case '@': // a spawn is an ordinary floor tile that a chef starts on
      return { t: 'floor' };
    case '#':
      return { t: 'counter', item: null };
    case 'B':
      return { t: 'board', item: null, chopMs: 0 };
    case 'S':
      return { t: 'stove', pot: { kind: 'pot', contents: [], cookMs: 0, state: 'idle' } };
    case 'F':
      return { t: 'stove', pot: { kind: 'pan', contents: [], cookMs: 0, state: 'idle' } };
    case 'P':
      return { t: 'plates' };
    case 'W':
      return { t: 'serve' };
    case 'X':
      return { t: 'trash' };
    case 'E':
      return { t: 'extinguisher', item: { kind: 'extinguisher' } };
    default: {
      const crate = CRATE_OF[ch];
      if (crate) return { t: 'crate', crate };
      throw new Error(`unknown tile character ${JSON.stringify(ch)}`);
    }
  }
}

/** True for tiles a player may stand on. */
function isWalkable(tile: Tile): boolean {
  return tile.t === 'floor';
}

/** What a level's stations can do — the input to the menu feasibility check. */
export function capabilitiesOf(tiles: readonly Tile[]): KitchenCapabilities {
  const crates = new Set<IngredientType>();
  let boards = 0;
  let pots = 0;
  let pans = 0;
  for (const tile of tiles) {
    if (tile.t === 'crate' && tile.crate) crates.add(tile.crate);
    if (tile.t === 'board') boards++;
    const vessel = tile.t === 'stove' ? tile.pot : tile.item?.kind === 'pot' ? tile.item.pot : null;
    if (vessel?.kind === 'pan') pans++;
    else if (vessel) pots++;
  }
  return { crates, boards, pots, pans };
}

/** Floor tiles reachable from `start`, as a flat boolean mask. */
function reachableFloor(tiles: readonly Tile[], w: number, h: number, start: Vec2): boolean[] {
  const seen = new Array<boolean>(w * h).fill(false);
  const from = start.y * w + start.x;
  if (!isWalkable(tiles[from]!)) return seen;
  seen[from] = true;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni] || !isWalkable(tiles[ni]!)) continue;
      seen[ni] = true;
      queue.push(ni);
    }
  }
  return seen;
}

/** Stations a chef has to be able to walk up to for the level to be playable. */
const MUST_REACH: ReadonlySet<Tile['t']> = new Set([
  'crate',
  'board',
  'stove',
  'plates',
  'serve',
  'trash',
  'extinguisher',
]);

function positive(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got ${value}`);
  }
  return value;
}

/**
 * Turn one authored level into a playable one. Every call builds brand new
 * Tile, Pot and Vec2 objects, so two rounds of the same level share nothing.
 */
export function parseLevel(def: LevelDef, world: WorldDef): Level {
  const where = `level ${def.id}`;
  const rows = def.rows;
  const h = rows.length;
  if (h < 3) throw new Error(`${where}: needs at least 3 rows`);
  const w = rows[0]!.length;
  if (w < 3) throw new Error(`${where}: needs at least 3 columns`);

  const tiles: Tile[] = new Array(w * h);
  const spawns: Vec2[] = [];
  for (let y = 0; y < h; y++) {
    const row = rows[y]!;
    if (row.length !== w) {
      throw new Error(`${where}: row ${y} has width ${row.length}, expected ${w}`);
    }
    for (let x = 0; x < w; x++) {
      const ch = row[x]!;
      try {
        tiles[y * w + x] = tileFromChar(ch);
      } catch (err) {
        throw new Error(`${where}: row ${y}, column ${x}: ${(err as Error).message}`);
      }
      if (ch === '@') spawns.push({ x, y });
    }
  }

  if (spawns.length < MIN_SPAWNS) {
    throw new Error(`${where}: needs at least ${MIN_SPAWNS} spawns ('@'), found ${spawns.length}`);
  }

  // One connected room. Chefs are seated round-robin, so a spawn behind a wall
  // would strand whoever drew it, and a station nobody can walk to is a dish
  // nobody can cook.
  const reach = reachableFloor(tiles, w, h, spawns[0]!);
  for (const s of spawns) {
    if (!reach[s.y * w + s.x]) {
      throw new Error(`${where}: spawn (${s.x}, ${s.y}) is cut off from the rest of the kitchen`);
    }
  }
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]!;
    if (!MUST_REACH.has(tile.t)) continue;
    const x = i % w;
    const y = (i - x) / w;
    const open = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => {
      const nx = x + dx!;
      const ny = y + dy!;
      return nx >= 0 && ny >= 0 && nx < w && ny < h && reach[ny * w + nx] === true;
    });
    if (!open) throw new Error(`${where}: the ${tile.t} at (${x}, ${y}) cannot be reached`);
  }

  // Every kitchen needs the four fixtures a round cannot run without.
  for (const t of ['plates', 'serve', 'trash', 'extinguisher'] as const) {
    if (!tiles.some((tile) => tile.t === t)) throw new Error(`${where}: no ${t} tile`);
  }

  const menu = [...def.menu];
  try {
    assertMenuMakeable(menu, capabilitiesOf(tiles));
  } catch (err) {
    throw new Error(`${where}: ${(err as Error).message}`);
  }

  return {
    id: def.id,
    name: def.name,
    worldId: world.id,
    worldName: world.name,
    index: world.levels.indexOf(def) + 1,
    count: world.levels.length,
    w,
    h,
    tiles,
    spawns,
    menu,
    roundMs: positive(`${where}: roundMs`, def.roundMs, ROUND_MS),
    orderMs: positive(`${where}: orderMs`, def.orderMs, ORDER_MS),
    orderSpawnMs: positive(`${where}: orderSpawnMs`, def.orderSpawnMs, ORDER_SPAWN_MS),
    maxOrders: Math.floor(positive(`${where}: maxOrders`, def.maxOrders, MAX_ORDERS)),
  };
}
