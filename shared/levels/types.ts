// The declarative half of a level: what a world and a level *are*, with no
// parsing, no validation and no drawing. Pure data types, safe to import from
// the server, the host renderer, the controller and the bots alike.
//
// Adding content should never mean writing code. A world is a file under
// `worlds/` that exports one `WorldDef`; a level inside it is an ASCII map, a
// menu of DishIds, and optionally a few tuning numbers. `parse.ts` turns that
// into tiles and refuses anything unplayable.

import type { DishId } from '../catalogue';

/**
 * Which set of flourishes the renderer draws for a world. Deliberately a
 * closed union: a motif is a small amount of bespoke drawing code (an awning,
 * a neon strip), so a new one is a deliberate act, not a typo in a data file.
 */
export type WorldMotif = 'home' | 'seaside' | 'night';

/**
 * A world's look, as data. The renderer resolves this once per frame and
 * passes it down; no draw function reaches for a global palette, which is what
 * lets two worlds share every drawing routine and still look nothing alike.
 *
 * Food and chefs are deliberately absent: an onion is the same onion in every
 * world (its colours come from `shared/catalogue.ts`), and a chef has to stay
 * recognisable as their own colour wherever they are cooking.
 */
export interface WorldTheme {
  motif: WorldMotif;

  /** Cartoon outline for the stations. */
  ink: string;
  /** Drop shadow under a station. */
  shadow: string;

  /** Alternating floor bands, the seam between them, and the grain on top. */
  floorA: string;
  floorB: string;
  floorSeam: string;
  floorGrain: string;
  /** Corner darkening inside the kitchen, so the room reads as a room. */
  vignette: string;

  /** Counter slab: gradient top, gradient bottom, and the flat face colour. */
  counterTop: string;
  counterBottom: string;
  counterFace: string;

  /** The chunky border drawn around the whole kitchen tray. */
  frame: string;
  /** Full-screen gradient behind the tray. */
  backdropTop: string;
  backdropBottom: string;

  /** HUD band and the rule under it. */
  hudBg: string;
  hudEdge: string;
  /** The world's signature colour: score star, clock pill, motif highlights. */
  accent: string;

  /**
   * Reserved for sprite packs. Nothing loads assets yet and nothing may start
   * without this being planned for: the field exists so a future pack is a
   * data change in a world file, not a change to every draw call.
   */
  assets?: Record<string, never>;
}

/** One level, as authored. Everything optional falls back to `shared/types`. */
export interface LevelDef {
  /** Stable id, `<world>-<n>`. It travels on the wire and in room records. */
  id: string;
  name: string;
  /** ASCII kitchen; see `parse.ts` for the legend. Rows must be equal length. */
  rows: readonly string[];
  /** The dishes this level's orders are drawn from. Must be cookable here. */
  menu: readonly DishId[];

  /** Round length. Default `ROUND_MS`. */
  roundMs?: number;
  /** How long a ticket lives. Default `ORDER_MS`. */
  orderMs?: number;
  /** Time between tickets. Default `ORDER_SPAWN_MS`. */
  orderSpawnMs?: number;
  /** Tickets on screen at once. Default `MAX_ORDERS`. */
  maxOrders?: number;
}

/** A world: a look, a mood, and its levels in playing order. */
export interface WorldDef {
  id: string;
  name: string;
  tagline: string;
  theme: WorldTheme;
  levels: readonly LevelDef[];
}
