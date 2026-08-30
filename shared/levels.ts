// Kitchen layouts. Owned by the game-server agent, but safe for the host
// renderer to import (pure data, no server dependencies).
//
// Coordinate convention (matches SPEC "target tile = round(pos + dir)"):
// integer coordinates are TILE CENTRES. Tile (i, j) covers the box
// [i - 0.5, i + 0.5] x [j - 0.5, j + 0.5]. Tiles are stored row-major, so
// tile (x, y) lives at index y * w + x.

import type { IngredientType, Tile, Vec2 } from './types';

export interface Level {
  w: number;
  h: number;
  tiles: Tile[];
  spawns: Vec2[];
}

/**
 * ASCII source of truth for the kitchen.
 *
 *   .  floor           #  plain counter
 *   O  onion crate     T  tomato crate     M  mushroom crate
 *   B  cutting board   S  stove (pot)      P  plate stack
 *   W  serve window    X  trash
 *
 * 13 x 8. Solid stations form the outer wall; a 5x2 island of counters and
 * two boards sits in the middle so players must route around each other.
 * Crates north-west, stoves north-east, plates + serve south-east, trash
 * south-west: every station is a different trip.
 */
const KITCHEN_ROWS = [
  '#OTM#####S#S#',
  '#...........#',
  '#...........#',
  '#...#B###...#',
  '#...###B#...#',
  '#...........#',
  '#...........P',
  '#X#########W#',
] as const;

/** Floor tiles players are placed on at the start of a round / on join. */
const KITCHEN_SPAWNS: readonly Vec2[] = [
  { x: 2, y: 2 },
  { x: 10, y: 2 },
  { x: 2, y: 5 },
  { x: 10, y: 5 },
  { x: 6, y: 1 },
  { x: 6, y: 6 },
];

const CRATE_OF: Record<string, IngredientType> = {
  O: 'onion',
  T: 'tomato',
  M: 'mushroom',
};

function tileFromChar(ch: string): Tile {
  switch (ch) {
    case '.':
      return { t: 'floor' };
    case '#':
      return { t: 'counter', item: null };
    case 'B':
      return { t: 'board', item: null, chopMs: 0 };
    case 'S':
      return { t: 'stove', pot: { contents: [], cookMs: 0, state: 'idle' } };
    case 'P':
      return { t: 'plates' };
    case 'W':
      return { t: 'serve' };
    case 'X':
      return { t: 'trash' };
    case 'O':
    case 'T':
    case 'M':
      return { t: 'crate', crate: CRATE_OF[ch] };
    default:
      throw new Error(`levels: unknown tile character ${JSON.stringify(ch)}`);
  }
}

/** True for tiles a player may stand on. */
export function isWalkable(tile: Tile): boolean {
  return tile.t === 'floor';
}

/**
 * Build a completely fresh copy of the kitchen: new Tile objects, new Pot
 * objects, new spawn vectors. Nothing is shared between two calls, so each
 * round starts from clean state.
 */
export function createLevel(): Level {
  const rows = KITCHEN_ROWS;
  const h = rows.length;
  const w = rows[0].length;
  const tiles: Tile[] = new Array(w * h);

  for (let y = 0; y < h; y++) {
    const row = rows[y];
    if (row.length !== w) {
      throw new Error(`levels: row ${y} has width ${row.length}, expected ${w}`);
    }
    for (let x = 0; x < w; x++) {
      tiles[y * w + x] = tileFromChar(row[x]);
    }
  }

  const spawns = KITCHEN_SPAWNS.map((s) => ({ x: s.x, y: s.y }));
  for (const s of spawns) {
    const tile = tiles[s.y * w + s.x];
    if (!tile || !isWalkable(tile)) {
      throw new Error(`levels: spawn (${s.x}, ${s.y}) is not a floor tile`);
    }
  }

  return { w, h, tiles, spawns };
}
