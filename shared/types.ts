// Shared game-state model. This file is the contract between server, host
// renderer, and controller. Do not change shapes without updating all three.

export interface Vec2 {
  x: number;
  y: number;
}

export type IngredientType = 'onion' | 'tomato' | 'mushroom';

export interface Ingredient {
  type: IngredientType;
  chopped: boolean;
}

export type HeldItem =
  | { kind: 'ingredient'; ing: Ingredient }
  // soup: null = empty plate; array = cooked soup contents on the plate
  | { kind: 'plate'; soup: IngredientType[] | null };

export type TileType =
  | 'floor'
  | 'counter'
  | 'crate' // infinite source of one raw ingredient (see Tile.crate)
  | 'board' // cutting board
  | 'stove' // holds a fixed pot (see Tile.pot)
  | 'plates' // infinite stack of clean plates
  | 'serve' // delivery window
  | 'trash';

export type PotState = 'idle' | 'cooking' | 'done' | 'burnt';

export interface Pot {
  contents: IngredientType[]; // chopped ingredients, max POT_CAPACITY
  cookMs: number; // elapsed cooking (or burning) time
  state: PotState;
}

export interface Tile {
  t: TileType;
  crate?: IngredientType; // only for t='crate'
  item?: HeldItem | null; // surface item, only counter/board can hold one
  chopMs?: number; // chop progress 0..CHOP_MS, only board with unchopped ingredient
  pot?: Pot; // only for t='stove'
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  pos: Vec2; // tile units, player center; (0,0) = top-left corner of grid
  dir: Vec2; // unit facing vector
  held: HeldItem | null;
  chopping: boolean; // true while actively chopping (renderer animates)
  dashMsLeft: number; // >0 while dashing
}

export interface Order {
  id: number;
  recipe: IngredientType[]; // sorted; soup = these 3 chopped + cooked
  msLeft: number;
  totalMs: number;
}

export type Phase = 'lobby' | 'playing' | 'gameover';

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
export const BURN_MS = 10000; // time after 'done' before 'burnt'
export const POT_CAPACITY = 3;
export const ROUND_MS = 180_000;
export const ORDER_MS = 60_000; // order lifetime
export const ORDER_SPAWN_MS = 15_000; // new order cadence (also 1 at start)
export const MAX_ORDERS = 5;
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
