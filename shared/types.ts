// Shared game-state model. This file is the contract between server, host
// renderer, and controller. Do not change shapes without updating all three.

export interface Vec2 {
  x: number;
  y: number;
}

// The ingredient and dish catalogue is the data half of the contract; it
// lives in shared/catalogue.ts so pure food data stays free of wire shapes.
export type { DishId, IngredientType } from './catalogue';
import type { DishId, IngredientType } from './catalogue';

/** One physical piece of food, plus everything that has been done to it. */
export interface Ingredient {
  type: IngredientType;
  chopped: boolean;
  cooked: boolean;
}

export type HeldItem =
  | { kind: 'ingredient'; ing: Ingredient }
  // A plate. `contents` empty = clean plate; otherwise the parts plated so
  // far, in the order they were added.
  | { kind: 'plate'; contents: Ingredient[] }
  // A pot or pan off its ring. Its timers only run while it sits on a stove,
  // so carried cookware is frozen wherever its cooking got to.
  | { kind: 'pot'; pot: Pot }
  | { kind: 'extinguisher' };

export type TileType =
  | 'floor'
  | 'counter'
  | 'crate' // infinite source of one raw ingredient (see Tile.crate)
  | 'board' // cutting board
  | 'stove' // holds a fixed pot (see Tile.pot)
  | 'plates' // infinite stack of clean plates
  | 'serve' // delivery window
  | 'trash'
  | 'extinguisher'; // wall bracket, holds the one extinguisher (see Tile.item)

export type PotState = 'idle' | 'cooking' | 'done' | 'burnt';

/**
 * A cooking vessel. Both kinds behave identically to a player — things go in,
 * a plate takes what comes out — they differ only in what they accept and how
 * much: a pot boils a batch (3 vegetables, or 1 rice), a pan fries one patty.
 */
export interface Pot {
  kind: 'pot' | 'pan';
  contents: Ingredient[]; // prepared ingredients, at most one batch
  cookMs: number; // elapsed cooking (or burning) time
  state: PotState;
}

/** A tile that is alight. Fire is put out by spraying, never by itself. */
export interface Fire {
  ms: number; // time since ignition; drives the spread clock and the flicker
  sprayMs: number; // foam landed on this tile so far, 0..EXTINGUISH_MS
}

export interface Tile {
  t: TileType;
  crate?: IngredientType; // only for t='crate'
  item?: HeldItem | null; // surface item, only counter/board can hold one
  chopMs?: number; // chop progress 0..CHOP_MS, only board with unchopped ingredient
  // Only for t='stove'. null = a bare ring: someone carried the pot away.
  // A pot on a counter is an ordinary `item` ({kind:'pot'}) instead.
  pot?: Pot | null;
  fire?: Fire; // present only while this tile is burning (never on floor)
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  pos: Vec2; // tile units, player center; (0,0) = top-left corner of grid
  dir: Vec2; // unit facing vector
  held: HeldItem | null;
  chopping: boolean; // true while actively chopping (renderer animates)
  spraying: boolean; // true while the extinguisher trigger is held
  dashMsLeft: number; // >0 while dashing
}

export interface Order {
  id: number;
  dish: DishId; // ticket title; the recipe below is DISHES[dish].parts
  recipe: IngredientType[]; // sorted multiset of the dish's parts
  msLeft: number;
  totalMs: number;
}

export type Phase = 'lobby' | 'playing' | 'gameover';

/**
 * Who stopped the kitchen. Any chef may pause and any chef may resume, so this
 * is the round's answer to "who did that?" on the TV and on every phone.
 *
 * `name` and `color` are copies, not a lookup: the chef who paused may put
 * their phone down and walk off, and the screen still has to say who it was.
 */
export interface PauseState {
  by: string; // playerId
  name: string;
  color: string;
  /** Time spent paused so far. Drives the overlay's pulse. */
  sinceMs: number;
}

/** How well a dish landed, from the matched order's remaining fraction. */
export type ServeTier = 'good' | 'great' | 'perfect';

/**
 * A one-shot thing that happened in the sim and that the TV celebrates.
 *
 * The renderer draws each one purely from its `id` (which seeds every jitter)
 * and from `now - at`, so it allocates nothing per frame, needs no state of
 * its own, and shows the same celebration on a screen that only just started
 * receiving snapshots.
 */
export interface FxEvent {
  id: number;
  t: 'serve';
  at: number; // Snapshot.elapsedMs when it happened
  tile: Vec2; // the serve window it went out of, in tile coordinates
  playerId: string;
  color: string; // the chef's colour, copied so the fx outlives their seat
  dish: DishId;
  points: number;
  tier: ServeTier;
  /** Consecutive `perfect` serves including this one; 0 when it is not one. */
  streak: number;
  /** The ticket's slot on the HUD rail, counted from the right, when it left. */
  slot: number;
}

export interface Snapshot {
  w: number;
  h: number;
  tiles: Tile[]; // row-major, length w*h
  players: PlayerState[];
  orders: Order[];
  score: number;
  served: number;
  missed: number; // expired orders
  msLeft: number; // round time remaining
  phase: Phase;
  // Non-null while the round is frozen. Every timer in the kitchen stops and
  // input edges are drained, so nothing fires the moment play resumes.
  paused: PauseState | null;
  // Round time elapsed, in sim ms, and the snapshot's one monotonic clock:
  // `msLeft` counts down from a per-level total, and both stop while paused.
  // `FxEvent.at` is measured against this. Named `elapsedMs` rather than
  // `roundMs` because a level's `roundMs` is its *total* length, and one name
  // for two things in one contract is a bug waiting to be written.
  elapsedMs: number;
  // Recent one-shot events for the renderer to celebrate: a short ring buffer
  // in the snapshot rather than a message of its own, so a celebration
  // survives the local-mode peer path, a checkpoint restore and a dropped
  // 20 Hz packet exactly like the rest of the world does.
  fx: FxEvent[];
  dishes: DishId[]; // this level's menu: the dishes orders are drawn from
  // Which kitchen this is. The renderer resolves the world's theme from
  // `worldId`; a resumed host rebuilds spawns and tuning from `levelId`.
  levelId: string;
  worldId: string;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  color: string;
}

// --- Tuning constants (authoritative on server; renderer may read them) ---
export const TICK_MS = 33; // ~30 Hz simulation
export const SNAPSHOT_MS = 50; // ~20 Hz broadcast to host
export const CHOP_MS = 1500;
export const COOK_MS = 8000; // full pot -> done
export const FRY_MS = 5000; // full pan -> done (one patty is quicker than a pot)
export const BURN_MS = 10000; // time after 'done' before 'burnt'
export const POT_CAPACITY = 3; // slots in a pot: must equal the largest boilBatch
export const PAN_CAPACITY = 1; // a skillet holds one thing at a time
export const FIRE_MS = 8000; // a burnt pot left on its ring this long ignites
export const FIRE_SPREAD_MS = 12_000; // a burning tile lights a neighbour this often
export const EXTINGUISH_MS = 1200; // foam needed to put one tile out
export const ROUND_MS = 180_000;
export const ORDER_MS = 60_000; // order lifetime
export const ORDER_SPAWN_MS = 15_000; // new order cadence (also 1 at start)
export const MAX_ORDERS = 5;
/** How long an FxEvent stays in the snapshot's ring buffer. */
export const FX_TTL_MS = 4000;
/** How many recent FxEvents a snapshot carries at most. */
export const FX_MAX = 8;
/** Remaining-time fractions at which a serve is promoted a tier. */
export const TIER_PERFECT = 0.66;
export const TIER_GREAT = 0.33;
/** Perfect serves in a row before the popup says so. */
export const STREAK_ON_FIRE = 3;
export const SERVE_POINTS = 20;
export const SERVE_TIME_BONUS_MAX = 10; // scaled by order msLeft fraction
export const EXPIRE_PENALTY = 10;
export const PLAYER_RADIUS = 0.35; // tile units
export const PLAYER_SPEED = 3.6; // tiles/sec
export const DASH_SPEED = 8.0; // tiles/sec while dashing
export const DASH_MS = 150;
export const DASH_COOLDOWN_MS = 500;
export const MAX_PLAYERS = 8;

export const PLAYER_COLORS = [
  '#e74c3c',
  '#3498db',
  '#2ecc71',
  '#f1c40f',
  '#9b59b6',
  '#e67e22',
  '#1abc9c',
  '#fd79a8',
];
