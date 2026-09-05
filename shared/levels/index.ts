// The level catalogue: every world, every level, in playing order.
//
// Adding a world is one file under `worlds/` and one line in `WORLDS`. Adding
// a level is one entry in that world's `levels` array. Nothing else in the
// codebase enumerates levels — the lobby card, the phone chooser, the "next
// level" button and the tests all read this list.

import type { Level } from './parse';
import { parseLevel } from './parse';
import type { LevelDef, WorldDef, WorldTheme } from './types';
import { GRILL } from './worlds/grill';
import { HOME } from './worlds/home';
import { SUSHI } from './worlds/sushi';

export type { Level } from './parse';
export type { LevelDef, WorldDef, WorldMotif, WorldTheme } from './types';
export { capabilitiesOf, isWalkable, parseLevel, CRATE_OF } from './parse';

/** Every world, in the order a table plays them. */
export const WORLDS: readonly WorldDef[] = [HOME, GRILL, SUSHI];

/** Every level, flattened, in the same order. */
export const LEVELS: readonly LevelDef[] = WORLDS.flatMap((w) => w.levels);

const WORLD_OF = new Map<string, WorldDef>();
const DEF_OF = new Map<string, LevelDef>();
for (const world of WORLDS) {
  for (const def of world.levels) {
    if (DEF_OF.has(def.id)) throw new Error(`levels: duplicate level id ${def.id}`);
    DEF_OF.set(def.id, def);
    WORLD_OF.set(def.id, world);
  }
}

/** The level a fresh room starts on, and the fallback for anything unknown. */
export const DEFAULT_LEVEL_ID = LEVELS[0]!.id;

/** True for an id that names a level we actually ship. */
export function isLevelId(id: unknown): id is string {
  return typeof id === 'string' && DEF_OF.has(id);
}

/** The world a level belongs to, or null for an unknown id. */
export function worldOf(levelId: string): WorldDef | null {
  return WORLD_OF.get(levelId) ?? null;
}

/** A world's look. Unknown ids fall back to the first world's theme. */
export function themeOf(worldId: string): WorldTheme {
  return (WORLDS.find((w) => w.id === worldId) ?? WORLDS[0]!).theme;
}

/** The next level in the run, or null when this is the last one. */
export function nextLevelId(levelId: string): string | null {
  const i = LEVELS.findIndex((l) => l.id === levelId);
  if (i < 0 || i + 1 >= LEVELS.length) return null;
  return LEVELS[i + 1]!.id;
}

/**
 * Build a completely fresh copy of a kitchen: new Tile objects, new Pot
 * objects, new spawn vectors. Nothing is shared between two calls, so each
 * round starts from clean state. Unknown ids throw — callers that take an id
 * off the wire must check `isLevelId` first.
 */
export function levelById(levelId: string): Level {
  const def = DEF_OF.get(levelId);
  const world = WORLD_OF.get(levelId);
  if (!def || !world) throw new Error(`levels: unknown level id ${JSON.stringify(levelId)}`);
  return parseLevel(def, world);
}

/** `levelById`, but any unknown id quietly becomes the default level. */
export function createLevel(levelId: string = DEFAULT_LEVEL_ID): Level {
  return levelById(isLevelId(levelId) ? levelId : DEFAULT_LEVEL_ID);
}
