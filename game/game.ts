// Authoritative kitchen simulation.
//
// Pure and deterministic: no ws / express / timers in here. The transport
// layer (server/index.ts) owns the clock and calls tick(dtMs), then forwards
// the returned buzz events to the right phones.

import type { Btn } from '../shared/protocol';
import {
  DISHES,
  INGREDIENTS,
  assertMenuMakeable,
  boilBatchOf,
  canAddToPlate,
  rawIngredient,
  sameMultiset,
  type DishId,
} from '../shared/catalogue';
import type { Level } from '../shared/levels';
import { DEFAULT_LEVEL_ID, capabilitiesOf, createLevel, isLevelId } from '../shared/levels';
import type {
  Fire,
  FxEvent,
  HeldItem,
  Ingredient,
  Order,
  PauseState,
  Phase,
  PlayerState,
  Pot,
  Snapshot,
  Tile,
  Vec2,
} from '../shared/types';
import {
  BURN_MS,
  CHOP_MS,
  COOK_MS,
  DASH_COOLDOWN_MS,
  DASH_MS,
  DASH_SPEED,
  EXPIRE_PENALTY,
  EXTINGUISH_MS,
  FIRE_MS,
  FIRE_SPREAD_MS,
  FRY_MS,
  PAN_CAPACITY,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  POT_CAPACITY,
  FX_MAX,
  FX_TTL_MS,
  SERVE_POINTS,
  SERVE_TIME_BONUS_MAX,
  TIER_GREAT,
  TIER_PERFECT,
} from '../shared/types';
import type { ServeTier } from '../shared/types';

/**
 * A haptic pulse the transport layer should forward to one controller. An
 * array is a vibrate pattern — buzz, pause, buzz, … — so a better serve can be
 * felt as well as seen.
 */
export interface BuzzEvent {
  playerId: string;
  buzzMs: number | number[];
}

const BUZZ_PICKUP = 25;
const BUZZ_PLACE = 30;
const BUZZ_CHOP_DONE = 70;
const BUZZ_FIRE_OUT = 90;
/** One pulse, two, or three: the serve tier, in the hand. */
const BUZZ_SERVE: Record<ServeTier, number | number[]> = {
  good: 150,
  great: [90, 60, 130],
  perfect: [70, 50, 70, 50, 170],
};

/** Longest dt a single tick may integrate, so a stalled loop cannot teleport. */
const MAX_DT_MS = 250;
/** Collision relaxation passes per tick. */
const COLLISION_PASSES = 3;
/** Fraction of the overlap each player resolves per tick (soft pushout). */
const PLAYER_PUSH = 0.5;
/** Button edges buffered between ticks, per button, per player. */
const MAX_QUEUED_PRESSES = 4;

// --- aim assist ------------------------------------------------------------
//
// The numbers behind `pickTarget`. They are tuned against one question: does
// the station a chef is looking at stay the station they act on, while their
// thumb wanders? See the aiming section for the reasoning.

/**
 * How far a chef can reach, centre to tile centre. Just over √2, so a station
 * leaned into from its diagonal is in reach and one two steps away never is.
 */
const REACH = 1.5;
/** Half-angle of the cone in front of a chef, as a cosine. 0.5 = ±60°. */
const MIN_ALIGN = 0.5;
/** Lining up with the facing is the chef's intent, so it leads the score. */
const W_ALIGN = 2.2;
/** Closer is better, but only enough to settle two tiles at the same angle. */
const W_NEAR = 0.3;
/**
 * A tile a press would actually do something on gets a nudge — never enough
 * to beat a station the chef is plainly pointing at, which is what keeps the
 * assist honest: it disambiguates, it does not decide.
 */
const W_USEFUL = 0.3;
/**
 * Head start the tile we already aim at keeps. Enough to absorb the few
 * degrees a thumb wanders around a tie; not enough to sit through a turn.
 */
const STICKY = 0.15;
/** Radians/s the facing eases onto the target while the stick is at rest. */
const SNAP_RATE = 7;

/** Per-player state that is not part of the wire snapshot. */
interface Runtime {
  s: PlayerState;
  move: Vec2;
  aPresses: number;
  bPresses: number;
  aDown: boolean;
  bDown: boolean;
  dashCooldownMs: number;
  dashDir: Vec2;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function cloneIngredient(ing: Ingredient): Ingredient {
  return { type: ing.type, chopped: ing.chopped === true, cooked: ing.cooked === true };
}

function clonePot(pot: Pot): Pot {
  return {
    kind: pot.kind === 'pan' ? 'pan' : 'pot',
    contents: pot.contents.map(cloneIngredient),
    cookMs: num(pot.cookMs),
    state: pot.state,
  };
}

function cloneItem(item: HeldItem | null | undefined): HeldItem | null {
  if (!item) return null;
  switch (item.kind) {
    case 'ingredient':
      return { kind: 'ingredient', ing: cloneIngredient(item.ing) };
    case 'plate':
      return { kind: 'plate', contents: (item.contents ?? []).map(cloneIngredient) };
    case 'pot':
      return { kind: 'pot', pot: clonePot(item.pot) };
    case 'extinguisher':
      return { kind: 'extinguisher' };
  }
}

function cloneTile(tile: Tile): Tile {
  const out: Tile = { t: tile.t };
  if (tile.crate) out.crate = tile.crate;
  if (tile.item !== undefined) out.item = cloneItem(tile.item);
  if (tile.chopMs !== undefined) out.chopMs = num(tile.chopMs);
  // `null` is meaningful on a stove (a ring whose pot was carried off), so the
  // key survives the round trip even when there is no pot.
  if (tile.pot !== undefined) out.pot = tile.pot ? clonePot(tile.pot) : null;
  if (tile.fire) out.fire = { ms: num(tile.fire.ms), sprayMs: num(tile.fire.sprayMs) };
  return out;
}

function clonePlayer(p: PlayerState, tileCount: number): PlayerState {
  const dx = num(p.dir?.x);
  const dy = num(p.dir?.y);
  const facing = Math.hypot(dx, dy) > 1e-4 ? { x: dx, y: dy } : { x: 0, y: 1 };
  // The target is a function of position, facing and tiles — all of which the
  // checkpoint carries — so it is kept rather than dropped: the TV that picks
  // the round back up highlights the right counter on its very first frame.
  const target = p.target;
  return {
    id: String(p.id),
    name: String(p.name),
    color: String(p.color),
    pos: { x: num(p.pos?.x), y: num(p.pos?.y) },
    dir: facing,
    held: cloneItem(p.held),
    chopping: false,
    spraying: false,
    dashMsLeft: 0,
    target:
      typeof target === 'number' && Number.isInteger(target) && target >= 0 && target < tileCount
        ? target
        : null,
  };
}

/** One checkpointed celebration, normalized so a stale build cannot crash the TV. */
function cloneFx(ev: FxEvent): FxEvent {
  return {
    id: num(ev.id),
    t: 'serve',
    at: num(ev.at),
    tile: { x: num(ev.tile?.x), y: num(ev.tile?.y) },
    playerId: String(ev.playerId ?? ''),
    color: String(ev.color ?? ''),
    dish: ev.dish,
    points: num(ev.points),
    tier: ev.tier === 'perfect' || ev.tier === 'great' ? ev.tier : 'good',
    streak: Math.max(0, num(ev.streak)),
    slot: Math.max(0, num(ev.slot)),
  };
}

/** A checkpointed pause, or null. Anything malformed reads as "not paused". */
function clonePause(p: PauseState | null | undefined): PauseState | null {
  if (!p || typeof p.by !== 'string' || p.by.length === 0) return null;
  return {
    by: p.by,
    name: String(p.name ?? ''),
    color: String(p.color ?? ''),
    sinceMs: Math.max(0, num(p.sinceMs)),
  };
}

export interface GameOptions {
  /** Seed the recipe RNG for reproducible runs (tests). */
  seed?: number;
  /** Which kitchen to cook in. Unknown ids fall back to the default level. */
  levelId?: string;
  /**
   * Override the level's own menu. Every dish must still be cookable with the
   * level's crates and stations, or the constructor throws. Tests use this to
   * pin one dish; normal play never passes it — a level owns its menu.
   */
  menu?: DishId[];
}

export class Game {
  /** Live snapshot; mutated in place and safe to JSON.stringify each frame. */
  readonly snapshot: Snapshot;

  private readonly rts = new Map<string, Runtime>();
  private readonly rand: () => number;
  private spawns: Vec2[];
  private orderTimerMs = 0;
  private nextOrderId = 1;
  private nextFxId = 1;
  /** Perfect serves in a row. Reset by anything less than perfect. */
  private perfectStreak = 0;
  /** The dishes orders are drawn from, and the plating rule's whole world. */
  private menu: DishId[] = [];
  /** A caller-pinned menu (tests). Null means "whatever the level declares". */
  private readonly menuOverride: DishId[] | null;
  /** Per-level tuning, defaulted from shared/types by the level parser. */
  private roundMs = 0;
  private orderMs = 0;
  private orderSpawnMs = 0;
  private maxOrders = 0;

  constructor(opts: GameOptions = {}) {
    this.rand = mulberry32(opts.seed ?? ((Math.random() * 0xffffffff) >>> 0));
    this.menuOverride = opts.menu ? [...opts.menu] : null;
    const level = createLevel(opts.levelId ?? DEFAULT_LEVEL_ID);
    this.spawns = level.spawns;
    this.snapshot = {
      w: level.w,
      h: level.h,
      tiles: level.tiles,
      players: [],
      orders: [],
      score: 0,
      served: 0,
      missed: 0,
      msLeft: level.roundMs,
      phase: 'lobby',
      paused: null,
      elapsedMs: 0,
      fx: [],
      dishes: [],
      levelId: level.id,
      worldId: level.worldId,
    };
    this.adopt(level);
  }

  /**
   * Take on a level: its menu, its tuning, its geometry. The menu check runs
   * here and nowhere else — an order nobody can cook is a level bug, and it is
   * much cheaper to catch on load than on the TV at −10 a ticket.
   */
  private adopt(level: Level): void {
    this.menu = this.menuOverride ? [...this.menuOverride] : [...level.menu];
    assertMenuMakeable(this.menu, capabilitiesOf(level.tiles));
    this.roundMs = level.roundMs;
    this.orderMs = level.orderMs;
    this.orderSpawnMs = level.orderSpawnMs;
    this.maxOrders = level.maxOrders;
    this.spawns = level.spawns;
    const s = this.snapshot;
    s.levelId = level.id;
    s.worldId = level.worldId;
    s.w = level.w;
    s.h = level.h;
    s.tiles = level.tiles;
    s.dishes = [...this.menu];
  }

  get phase(): Phase {
    return this.snapshot.phase;
  }

  /** Which kitchen this Game is currently set up to cook in. */
  get levelId(): string {
    return this.snapshot.levelId;
  }

  get playerCount(): number {
    return this.rts.size;
  }

  /** Who stopped the kitchen, or null while it is running. */
  get paused(): PauseState | null {
    return this.snapshot.paused;
  }

  // --- lifecycle -----------------------------------------------------------

  /**
   * Begin a round: fresh kitchen, fresh orders, everyone back on a spawn.
   * `levelId` switches kitchens first, so "start" and "play this level" are
   * the same call.
   */
  start(levelId?: string): void {
    this.resetWorld('playing', levelId);
    this.spawnOrder();
  }

  /** Return to the lobby (Play Again): fresh kitchen, no orders, no clock. */
  toLobby(levelId?: string): void {
    this.resetWorld('lobby', levelId);
  }

  private resetWorld(phase: Phase, levelId?: string): void {
    // An unknown id is ignored rather than fatal: it can only come off the
    // wire, and dropping the round because a phone sent junk is worse.
    const level = createLevel(isLevelId(levelId) ? levelId : this.snapshot.levelId);
    this.adopt(level);
    const s = this.snapshot;
    s.orders = [];
    s.score = 0;
    s.served = 0;
    s.missed = 0;
    s.msLeft = this.roundMs;
    s.phase = phase;
    s.paused = null;
    s.elapsedMs = 0;
    s.fx = [];
    this.orderTimerMs = 0;
    this.nextOrderId = 1;
    this.nextFxId = 1;
    this.perfectStreak = 0;

    let i = 0;
    for (const rt of this.rts.values()) {
      const spawn = level.spawns[i % level.spawns.length];
      i++;
      rt.s.pos = { x: spawn.x, y: spawn.y };
      rt.s.dir = { x: 0, y: 1 };
      rt.s.held = null;
      rt.s.chopping = false;
      rt.s.spraying = false;
      rt.s.dashMsLeft = 0;
      rt.s.target = null;
      rt.move = { x: 0, y: 0 };
      rt.aPresses = 0;
      rt.bPresses = 0;
      rt.aDown = false;
      rt.bDown = false;
      rt.dashCooldownMs = 0;
      rt.dashDir = { x: 0, y: 1 };
    }
  }

  /**
   * Rebuild this Game from a checkpointed Snapshot — a host that reconnected
   * after its serverless function (or its whole instance) went away resumes
   * mid-round from here. The snapshot is deep-copied, so the caller keeps
   * ownership of the object it passed in.
   *
   * Player input state is not part of a Snapshot: everyone resumes with an
   * idle stick and no buttons held. The order cadence restarts too, so the
   * next order lands at most ORDER_SPAWN_MS after the restore.
   */
  restoreSnapshot(src: Snapshot): void {
    if (!Number.isInteger(src.w) || !Number.isInteger(src.h) || src.w <= 0 || src.h <= 0) {
      throw new Error('restoreSnapshot: bad grid size');
    }
    if (!Array.isArray(src.tiles) || src.tiles.length !== src.w * src.h) {
      throw new Error('restoreSnapshot: tiles do not match the grid');
    }
    if (!Array.isArray(src.players) || !Array.isArray(src.orders)) {
      throw new Error('restoreSnapshot: missing players or orders');
    }

    // The checkpoint decides which kitchen this is: a host that reconnects
    // mid-round has to come back to the level the round is being played on,
    // menu, tuning and all. Anything unrecognised leaves us where we are.
    if (isLevelId(src.levelId) && src.levelId !== this.snapshot.levelId) {
      this.adopt(createLevel(src.levelId));
    }

    const s = this.snapshot;
    s.w = src.w;
    s.h = src.h;
    s.tiles = src.tiles.map(cloneTile);
    s.orders = src.orders.map((o) => ({ ...o, recipe: [...o.recipe] }));
    // The menu comes from the level, not from the checkpoint: a snapshot from
    // an older build may not carry one at all.
    s.dishes = [...this.menu];
    s.score = num(src.score);
    s.served = num(src.served);
    s.missed = num(src.missed);
    s.msLeft = clamp(num(src.msLeft), 0, this.roundMs);
    s.phase = src.phase === 'playing' || src.phase === 'gameover' ? src.phase : 'lobby';
    // A kitchen that was stopped comes back stopped: a host reconnect must not
    // set eight chefs running again while they are all looking at their phones.
    s.paused = s.phase === 'playing' ? clonePause(src.paused) : null;
    s.elapsedMs = Math.max(0, num(src.elapsedMs));
    s.fx = Array.isArray(src.fx) ? src.fx.slice(-FX_MAX).map(cloneFx) : [];

    this.rts.clear();
    s.players = [];
    for (const p of src.players) {
      const state = clonePlayer(p, s.tiles.length);
      this.rts.set(state.id, {
        s: state,
        move: { x: 0, y: 0 },
        aPresses: 0,
        bPresses: 0,
        aDown: false,
        bDown: false,
        dashCooldownMs: 0,
        dashDir: { x: state.dir.x, y: state.dir.y },
      });
      s.players.push(state);
    }

    // Tiles came from the checkpoint; spawns are level geometry.
    this.spawns = createLevel(s.levelId).spawns;
    this.orderTimerMs = 0;
    this.nextOrderId = s.orders.reduce((max, o) => Math.max(max, o.id), 0) + 1;
    this.nextFxId = s.fx.reduce((max, e) => Math.max(max, e.id), 0) + 1;
    // The streak is not in the wire shape; a resumed round starts counting
    // again rather than inventing one.
    this.perfectStreak = 0;
  }

  // --- roster --------------------------------------------------------------

  addPlayer(id: string, name: string, color: string): PlayerState {
    const existing = this.rts.get(id);
    if (existing) return existing.s;

    const spawn = this.freeSpawn();
    const s: PlayerState = {
      id,
      name,
      color,
      pos: { x: spawn.x, y: spawn.y },
      dir: { x: 0, y: 1 },
      held: null,
      chopping: false,
      spraying: false,
      dashMsLeft: 0,
      target: null,
    };
    this.rts.set(id, {
      s,
      move: { x: 0, y: 0 },
      aPresses: 0,
      bPresses: 0,
      aDown: false,
      bDown: false,
      dashCooldownMs: 0,
      dashDir: { x: 0, y: 1 },
    });
    this.snapshot.players.push(s);
    return s;
  }

  removePlayer(id: string): void {
    const rt = this.rts.get(id);
    if (!rt) return;
    // A chef whose phone dies must not take the kitchen's cookware with them:
    // the round has a fixed number of pots and exactly one extinguisher.
    this.returnCookware(rt.s.held);
    this.rts.delete(id);
    const i = this.snapshot.players.findIndex((p) => p.id === id);
    if (i >= 0) this.snapshot.players.splice(i, 1);
  }

  /**
   * Put the kitchen's own equipment back: a pot on a free ring, the
   * extinguisher on its bracket, either of them on a counter as a fallback.
   * Ingredients and plates are replaceable, so those just go with the chef.
   */
  private returnCookware(held: HeldItem | null): void {
    if (!held || (held.kind !== 'pot' && held.kind !== 'extinguisher')) return;
    const tiles = this.snapshot.tiles;
    const home = held.kind === 'pot' ? 'stove' : 'extinguisher';
    for (const tile of tiles) {
      if (tile.t !== home || tile.fire) continue;
      if (held.kind === 'pot') {
        if (tile.pot) continue;
        tile.pot = held.pot;
      } else {
        if (tile.item) continue;
        tile.item = held;
      }
      return;
    }
    for (const tile of tiles) {
      if (tile.t === 'counter' && !tile.item && !tile.fire) {
        tile.item = held;
        return;
      }
    }
  }

  hasPlayer(id: string): boolean {
    return this.rts.has(id);
  }

  /** Prefer a spawn tile with nobody standing on it; else round-robin. */
  private freeSpawn(): Vec2 {
    const spawns = this.spawns;
    for (const spawn of spawns) {
      let taken = false;
      for (const rt of this.rts.values()) {
        const dx = rt.s.pos.x - spawn.x;
        const dy = rt.s.pos.y - spawn.y;
        if (dx * dx + dy * dy < PLAYER_RADIUS * PLAYER_RADIUS * 4) {
          taken = true;
          break;
        }
      }
      if (!taken) return spawn;
    }
    return spawns[this.rts.size % spawns.length];
  }

  // --- input ---------------------------------------------------------------

  setMove(id: string, move: Vec2): void {
    const rt = this.rts.get(id);
    if (!rt) return;
    let x = Number.isFinite(move.x) ? move.x : 0;
    let y = Number.isFinite(move.y) ? move.y : 0;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    rt.move = { x, y };
  }

  press(id: string, btn: Btn): void {
    const rt = this.rts.get(id);
    if (!rt) return;
    // Cap the queue so a spamming phone cannot buy extra actions per tick.
    if (btn === 'a') {
      rt.aPresses = Math.min(rt.aPresses + 1, MAX_QUEUED_PRESSES);
      // A is held as well as tapped: empty-handed at a board, holding it down
      // is the chop (see `chopHeld`).
      rt.aDown = true;
    } else {
      rt.bPresses = Math.min(rt.bPresses + 1, MAX_QUEUED_PRESSES);
      rt.bDown = true;
    }
  }

  release(id: string, btn: Btn): void {
    const rt = this.rts.get(id);
    if (!rt) return;
    if (btn === 'a') rt.aDown = false;
    else rt.bDown = false;
  }

  /**
   * Stop the kitchen at this chef's request. Returns false — and changes
   * nothing — when there is no round to stop, when it is already stopped, or
   * when `id` is not a chef in it.
   *
   * The name and colour are copied out of the roster here, so the TV can still
   * say who did it after that chef's phone has gone to sleep.
   */
  pause(id: string): boolean {
    const rt = this.rts.get(id);
    const s = this.snapshot;
    if (!rt || s.phase !== 'playing' || s.paused) return false;
    s.paused = { by: id, name: rt.s.name, color: rt.s.color, sinceMs: 0 };
    return true;
  }

  /**
   * Start the kitchen again. Any chef may do this, not only the one who
   * paused: a phone that ran out of battery must never be able to hold the
   * whole table hostage.
   */
  resume(id: string): boolean {
    const s = this.snapshot;
    if (!this.rts.has(id) || s.phase !== 'playing' || !s.paused) return false;
    s.paused = null;
    return true;
  }

  // --- simulation ----------------------------------------------------------

  tick(dtMs: number): BuzzEvent[] {
    const events: BuzzEvent[] = [];
    const dt = clamp(Number.isFinite(dtMs) ? dtMs : 0, 0, MAX_DT_MS);
    if (this.snapshot.phase !== 'playing' || dt <= 0) {
      // Drain queued edges so they cannot fire when the round starts.
      if (this.snapshot.phase !== 'playing') {
        for (const rt of this.rts.values()) {
          rt.aPresses = 0;
          rt.bPresses = 0;
        }
      }
      return events;
    }

    const s = this.snapshot;

    // Paused: nothing in the kitchen moves, and every button pressed while the
    // game was stopped is thrown away rather than fired all at once on resume.
    // The one clock that keeps running is the pause's own.
    if (s.paused) {
      s.paused.sinceMs += dt;
      for (const rt of this.rts.values()) {
        rt.aPresses = 0;
        rt.bPresses = 0;
      }
      return events;
    }

    s.msLeft = Math.max(0, s.msLeft - dt);
    s.elapsedMs += dt;
    this.pruneFx();
    this.updateOrders(dt);
    this.updatePots(dt);
    this.updateFires(dt);

    // Facing follows the last nonzero stick direction.
    for (const rt of this.rts.values()) {
      const len = Math.hypot(rt.move.x, rt.move.y);
      if (len > 1e-4) rt.s.dir = { x: rt.move.x / len, y: rt.move.y / len };
      rt.s.dashMsLeft = Math.max(0, rt.s.dashMsLeft - dt);
      rt.dashCooldownMs = Math.max(0, rt.dashCooldownMs - dt);
    }

    // One aim per chef per tick: every button below reads it, and so does the
    // TV. Nothing may re-derive what a press is about to hit.
    this.updateAim(dt);

    for (const rt of this.rts.values()) {
      while (rt.aPresses > 0) {
        rt.aPresses--;
        this.actionA(rt, events);
      }
      while (rt.bPresses > 0) {
        rt.bPresses--;
        this.actionB(rt);
      }
    }

    this.updateChopping(dt, events);
    this.updateSpraying(dt, events);
    this.moveAndCollide(dt);

    if (s.msLeft <= 0) s.phase = 'gameover';
    return events;
  }

  // --- orders --------------------------------------------------------------

  private spawnOrder(): void {
    if (this.snapshot.orders.length >= this.maxOrders) return;
    const dish = this.menu[Math.floor(this.rand() * this.menu.length) % this.menu.length]!;
    const order: Order = {
      id: this.nextOrderId++,
      dish,
      recipe: [...DISHES[dish].parts],
      msLeft: this.orderMs,
      totalMs: this.orderMs,
    };
    this.snapshot.orders.push(order);
  }

  private updateOrders(dt: number): void {
    const s = this.snapshot;
    for (let i = s.orders.length - 1; i >= 0; i--) {
      const o = s.orders[i];
      o.msLeft -= dt;
      if (o.msLeft <= 0) {
        o.msLeft = 0;
        s.orders.splice(i, 1);
        s.score -= EXPIRE_PENALTY;
        s.missed++;
      }
    }

    this.orderTimerMs += dt;
    while (this.orderTimerMs >= this.orderSpawnMs) {
      this.orderTimerMs -= this.orderSpawnMs;
      this.spawnOrder();
    }
  }

  // --- pots ----------------------------------------------------------------

  private updatePots(dt: number): void {
    const tiles = this.snapshot.tiles;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i]!;
      // Only a ring cooks. A pot on a counter or in a chef's hands is off the
      // heat, so its timers freeze exactly where they were.
      if (tile.t !== 'stove') continue;
      const pot = tile.pot;
      if (!pot) continue;
      if (pot.state === 'cooking') {
        // Only a full vessel actually cooks: a batch is all-or-nothing.
        if (pot.contents.length >= Game.batchOf(pot)) {
          pot.cookMs += dt;
          if (pot.cookMs >= Game.cookTimeOf(pot)) {
            pot.state = 'done';
            pot.cookMs = 0;
            // Cooking is what makes the contents ready to plate.
            for (const ing of pot.contents) ing.cooked = true;
          }
        }
      } else if (pot.state === 'done') {
        pot.cookMs += dt;
        if (pot.cookMs >= BURN_MS) {
          pot.state = 'burnt';
          pot.cookMs = 0;
        }
      } else if (pot.state === 'burnt' && !tile.fire) {
        // Char left over a lit ring eventually catches. Carry the pot off (or
        // dump it) and the clock stops with it.
        pot.cookMs += dt;
        if (pot.cookMs >= FIRE_MS) {
          pot.cookMs = 0;
          this.ignite(tile);
        }
      }
    }
  }

  // --- fire ----------------------------------------------------------------

  /**
   * Set a tile alight. Pots and the extinguisher survive the flames — the
   * round has exactly as many of them as it started with — but a pot's
   * contents are ruined. Anything else on the tile is gone.
   */
  private ignite(tile: Tile): void {
    if (tile.t === 'floor' || tile.fire) return;
    tile.fire = { ms: 0, sprayMs: 0 };
    const item = tile.item;
    const pot = tile.t === 'stove' ? tile.pot : item?.kind === 'pot' ? item.pot : null;
    if (pot) {
      pot.state = 'burnt';
      pot.cookMs = 0;
    } else if (item && item.kind !== 'extinguisher') {
      tile.item = null;
    }
    if (tile.t === 'board') tile.chopMs = 0;
  }

  private updateFires(dt: number): void {
    const tiles = this.snapshot.tiles;
    // Take the burning set first: a tile lit this tick does not spread yet.
    const burning: number[] = [];
    for (let i = 0; i < tiles.length; i++) if (tiles[i]!.fire) burning.push(i);
    for (const i of burning) {
      const fire = tiles[i]!.fire as Fire;
      const before = Math.floor(fire.ms / FIRE_SPREAD_MS);
      fire.ms += dt;
      const after = Math.floor(fire.ms / FIRE_SPREAD_MS);
      for (let n = before; n < after; n++) this.spreadFrom(i);
    }
  }

  /** Light one random neighbour of a burning tile. */
  private spreadFrom(from: number): void {
    const s = this.snapshot;
    const x = from % s.w;
    const y = Math.floor(from / s.w);
    const options: Tile[] = [];
    for (const d of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const tile = this.tileAt(x + d.x, y + d.y);
      if (!tile || tile.fire || tile.t === 'floor') continue;
      // The serve window and the extinguisher bracket never burn: losing
      // either one would leave the round with no way out of the fire.
      if (tile.t === 'serve' || tile.t === 'extinguisher') continue;
      options.push(tile);
    }
    if (options.length === 0) return;
    this.ignite(options[Math.floor(this.rand() * options.length)]!);
  }

  private static emptyPot(pot: Pot): void {
    pot.contents = [];
    pot.cookMs = 0;
    pot.state = 'idle';
  }

  /**
   * How many pieces this vessel needs before it starts, and therefore how many
   * it holds. A pan takes one; a pot takes one batch of whatever is already in
   * it (three vegetables, or a single portion of rice).
   */
  private static batchOf(pot: Pot): number {
    if (pot.kind === 'pan') return PAN_CAPACITY;
    const first = pot.contents[0];
    return first ? boilBatchOf(first.type) : POT_CAPACITY;
  }

  private static cookTimeOf(pot: Pot): number {
    return pot.kind === 'pan' ? FRY_MS : COOK_MS;
  }

  /**
   * Whether this vessel will take that ingredient. The catalogue decides: a
   * pot boils, a pan fries, and a pot only ever holds one batch size at once —
   * which is what stops rice being stirred into a vegetable soup.
   */
  private static vesselAccepts(pot: Pot, ing: Ingredient): boolean {
    if (pot.state === 'done' || pot.state === 'burnt') return false;
    const def = INGREDIENTS[ing.type];
    if (def.chop && !ing.chopped) return false;
    if (ing.cooked) return false; // already cooked: nothing left to do to it
    if (pot.kind === 'pan') {
      return def.cook === 'fry' && pot.contents.length < PAN_CAPACITY;
    }
    if (def.cook !== 'boil') return false;
    const first = pot.contents[0];
    if (first && boilBatchOf(first.type) !== boilBatchOf(ing.type)) return false;
    return pot.contents.length < boilBatchOf(ing.type);
  }

  /**
   * Put something into a pot, or take the soup out of it. Shared by stove
   * rings and pots sitting on a counter so both read identically to a player.
   */
  private usePot(p: PlayerState, pot: Pot, held: HeldItem, buzz: (ms: number) => void): void {
    if (held.kind === 'ingredient') {
      if (!Game.vesselAccepts(pot, held.ing)) return;
      pot.contents.push(held.ing);
      pot.state = 'cooking';
      p.held = null;
      buzz(BUZZ_PLACE);
      return;
    }
    // Plate on a finished vessel: tip the whole batch out onto it.
    if (held.kind !== 'plate') return;
    if (!this.pourInto(held.contents, pot)) return;
    buzz(BUZZ_PLACE);
  }

  /**
   * Whether a finished vessel would go onto this plate. All or nothing: every
   * piece has to be something the plate is allowed to take, so a pot of soup
   * cannot be poured half-way onto a half-built burger.
   */
  private canPourInto(contents: readonly Ingredient[], pot: Pot): boolean {
    if (pot.state !== 'done' || pot.contents.length === 0) return false;
    const staged = [...contents];
    for (const ing of pot.contents) {
      if (!this.canPlate(staged, ing)) return false;
      staged.push(ing);
    }
    return true;
  }

  /** Tip a finished vessel onto a plate, if the whole batch is welcome. */
  private pourInto(contents: Ingredient[], pot: Pot): boolean {
    if (!this.canPourInto(contents, pot)) return false;
    contents.push(...pot.contents);
    Game.emptyPot(pot);
    return true;
  }

  /** The one plating rule, in terms of this round's menu. */
  private canPlate(contents: readonly Ingredient[], ing: Ingredient): boolean {
    return canAddToPlate(contents, ing, this.menu);
  }

  // --- tiles ---------------------------------------------------------------

  private tileAt(x: number, y: number): Tile | null {
    const s = this.snapshot;
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) return null;
    return s.tiles[y * s.w + x];
  }

  // --- aiming --------------------------------------------------------------
  //
  // Which station a chef is about to act on. One answer per tick, written to
  // `PlayerState.target`, read by every button and drawn by the TV — so the
  // tile the screen highlights is, by construction, the tile the press lands
  // on.
  //
  // This used to be `round(pos + dir)`, and that single line is what players
  // were complaining about: an analog stick wobbles as it comes to rest, a
  // diagonal lean picks the corner tile, and half a tile of drift silently
  // retargets a press onto the counter next door. Instead every station within
  // reach is scored on
  //
  //   * how well it lines up with the facing (the chef's stated intent),
  //   * how close it is (settles two tiles at the same angle),
  //   * whether a press would do anything at all given what is in hand,
  //
  // and the tile already aimed at keeps a head start, so the choice cannot
  // flicker between two neighbours. Facing eases onto the chosen tile while
  // the stick is at rest, which makes the chevron on screen and the press
  // agree without ever moving a chef who did not ask to move.

  private updateAim(dt: number): void {
    for (const rt of this.rts.values()) {
      const ti = this.pickTarget(rt.s);
      rt.s.target = ti;
      // The stick always wins: squaring up only ever happens on a thumb that
      // has let go, and never mid-dash.
      if (ti === null || rt.s.dashMsLeft > 0) continue;
      if (Math.hypot(rt.move.x, rt.move.y) > 1e-4) continue;
      this.snapFacing(rt.s, ti, dt);
    }
  }

  /** The station this chef is aiming at, or null when none is in reach. */
  private pickTarget(p: PlayerState): number | null {
    const s = this.snapshot;
    const len = Math.hypot(p.dir.x, p.dir.y);
    if (len < 1e-4) return null;
    const fx = p.dir.x / len;
    const fy = p.dir.y / len;
    const prev = p.target;

    const minX = Math.max(0, Math.ceil(p.pos.x - REACH));
    const maxX = Math.min(s.w - 1, Math.floor(p.pos.x + REACH));
    const minY = Math.max(0, Math.ceil(p.pos.y - REACH));
    const maxY = Math.min(s.h - 1, Math.floor(p.pos.y + REACH));

    let best = -Infinity;
    let bestIdx: number | null = null;
    let prevScore = -Infinity;

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const i = ty * s.w + tx;
        const tile = s.tiles[i]!;
        if (tile.t === 'floor') continue;
        const ox = tx - p.pos.x;
        const oy = ty - p.pos.y;
        const d = Math.hypot(ox, oy);
        if (d > REACH || d < 1e-6) continue;
        const align = (ox * fx + oy * fy) / d;
        if (align < MIN_ALIGN) continue;
        const score =
          W_ALIGN * align + W_NEAR * (REACH - d) + (this.affords(tile, p.held) ? W_USEFUL : 0);
        if (i === prev) prevScore = score;
        if (score > best) {
          best = score;
          bestIdx = i;
        }
      }
    }

    // Hysteresis. The tile we were already on stays ours until something is
    // clearly better, which is what stops a target humming between two
    // counters while a chef stands still.
    if (prev !== null && prevScore > -Infinity && best - prevScore <= STICKY) return prev;
    return bestIdx;
  }

  /** Ease the facing onto the target's centre. Rate-limited, never a snap. */
  private snapFacing(p: PlayerState, ti: number, dt: number): void {
    const s = this.snapshot;
    const ox = (ti % s.w) - p.pos.x;
    const oy = Math.floor(ti / s.w) - p.pos.y;
    const d = Math.hypot(ox, oy);
    if (d < 1e-6) return;
    const step = (SNAP_RATE * dt) / 1000;
    const have = Math.atan2(p.dir.y, p.dir.x);
    let delta = ((Math.atan2(oy, ox) - have + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) <= step) {
      p.dir = { x: ox / d, y: oy / d };
      return;
    }
    const a = have + (delta > 0 ? step : -step);
    p.dir = { x: Math.cos(a), y: Math.sin(a) };
  }

  /**
   * Would a press do anything on this tile, holding this? That is button A's
   * table below, plus the one thing only B can do: foam on a fire. (B's chop
   * needs no case of its own — a board with something on it already affords A
   * to an empty hand, and a chef with a full hand is not picking which board
   * to chop on.)
   *
   * The aim only uses this to break near-ties, so it can never put a chef's
   * onion somewhere they were not pointing. It does have to agree with the
   * table, though, and a test in game.test.ts pins the two together: it presses
   * A on every tile-and-hand combination it can build and checks that the
   * kitchen changed exactly when this said it would.
   */
  private affords(tile: Tile, held: HeldItem | null): boolean {
    // A burning tile refuses every A press; foam is the only answer.
    if (tile.fire) return held?.kind === 'extinguisher';

    switch (tile.t) {
      case 'floor':
        return false;
      case 'crate':
        return !held && tile.crate !== undefined;
      case 'plates':
        return !held;
      case 'serve':
        return held?.kind === 'plate' && held.contents.length > 0;
      case 'trash':
        if (!held) return false;
        if (held.kind === 'ingredient') return true;
        if (held.kind === 'pot') return held.pot.contents.length > 0 || held.pot.state !== 'idle';
        return held.kind === 'plate' && held.contents.length > 0;
      case 'extinguisher':
        if (!held) return tile.item?.kind === 'extinguisher';
        return held.kind === 'extinguisher' && !tile.item;
      case 'stove': {
        const pot = tile.pot;
        if (!pot) return held?.kind === 'pot';
        if (!held) return true; // lift it off, or dump the char
        return this.affordsPot(pot, held);
      }
      case 'counter':
      case 'board': {
        const item = tile.item;
        if (!held) return !!item;
        const surfacePot = item?.kind === 'pot' ? item.pot : null;
        if (surfacePot) return this.affordsPot(surfacePot, held);
        if (held.kind === 'pot' && item?.kind === 'plate') {
          return this.canPourInto(item.contents, held.pot);
        }
        if (held.kind === 'ingredient' && item?.kind === 'plate') {
          return this.canPlate(item.contents, held.ing);
        }
        if (held.kind === 'plate' && item?.kind === 'ingredient') {
          return this.canPlate(held.contents, item.ing);
        }
        if (item) return false;
        // Boards only accept ingredients (that is all you can chop).
        return tile.t !== 'board' || held.kind === 'ingredient';
      }
    }
  }

  /** The vessel half of `affords`, for a ring and a counter pot alike. */
  private affordsPot(pot: Pot, held: HeldItem): boolean {
    if (held.kind === 'ingredient') return Game.vesselAccepts(pot, held.ing);
    if (held.kind === 'plate') return this.canPourInto(held.contents, pot);
    return false;
  }

  // --- button A: grab / put ------------------------------------------------

  private actionA(rt: Runtime, events: BuzzEvent[]): void {
    const p = rt.s;
    const ti = p.target;
    if (ti === null) return;
    const tile = this.snapshot.tiles[ti];
    if (!tile) return;
    const held = p.held;
    const buzz = (ms: number | number[]) => events.push({ playerId: p.id, buzzMs: ms });
    // You cannot take from or put onto a fire. Put it out first.
    if (tile.fire) return;

    switch (tile.t) {
      case 'crate': {
        if (held || !tile.crate) return;
        p.held = { kind: 'ingredient', ing: rawIngredient(tile.crate) };
        buzz(BUZZ_PICKUP);
        return;
      }

      case 'plates': {
        if (held) return;
        p.held = { kind: 'plate', contents: [] };
        buzz(BUZZ_PICKUP);
        return;
      }

      case 'counter':
      case 'board': {
        const item = tile.item;
        const surfacePot = item?.kind === 'pot' ? item.pot : null;
        if (!held) {
          if (!item) return;
          // A burnt pot dumps its char before it can be carried, exactly as it
          // does on a stove: one press to clear it, another to pick it up.
          if (surfacePot && surfacePot.state === 'burnt') {
            Game.emptyPot(surfacePot);
            buzz(BUZZ_PLACE);
            return;
          }
          // Empty hands at a board with something raw on it: the only thing
          // anyone ever means is "chop that", so A is the chop (held down,
          // exactly like B) instead of snatching the ingredient back. Once it
          // is chopped the same button picks it up again.
          if (Game.choppable(tile)) return;
          p.held = item;
          tile.item = null;
          if (tile.t === 'board') {
            tile.chopMs = 0; // picking up aborts chop progress
            this.stopChoppingAt(ti);
          }
          buzz(BUZZ_PICKUP);
          return;
        }
        // A pot on a surface works like a stove's ring, minus the heat.
        if (surfacePot) {
          this.usePot(p, surfacePot, held, buzz);
          return;
        }
        // Pouring a finished vessel onto a waiting plate: the food moves, the
        // cookware stays in hand.
        if (held.kind === 'pot' && item?.kind === 'plate') {
          if (!this.pourInto(item.contents, held.pot)) return;
          buzz(BUZZ_PLACE);
          return;
        }
        // Assembling on a surface. Both directions are the same rule: a
        // prepared part joins a plate as long as the plate is still on its way
        // to something on the menu.
        if (held.kind === 'ingredient' && item?.kind === 'plate') {
          if (!this.canPlate(item.contents, held.ing)) return;
          item.contents.push(held.ing);
          p.held = null;
          buzz(BUZZ_PLACE);
          return;
        }
        if (held.kind === 'plate' && item?.kind === 'ingredient') {
          if (!this.canPlate(held.contents, item.ing)) return;
          held.contents.push(item.ing);
          tile.item = null;
          if (tile.t === 'board') {
            tile.chopMs = 0;
            this.stopChoppingAt(ti);
          }
          buzz(BUZZ_PLACE);
          return;
        }
        if (item) return;
        // Boards only accept ingredients (that is all you can chop).
        if (tile.t === 'board' && held.kind !== 'ingredient') return;
        tile.item = held;
        p.held = null;
        if (tile.t === 'board') tile.chopMs = 0;
        buzz(BUZZ_PLACE);
        return;
      }

      case 'stove': {
        const pot = tile.pot;
        if (!pot) {
          // A bare ring takes nothing but a pot.
          if (!held || held.kind !== 'pot') return;
          tile.pot = held.pot;
          p.held = null;
          buzz(BUZZ_PLACE);
          return;
        }
        if (!held) {
          if (pot.state === 'burnt') {
            Game.emptyPot(pot);
            buzz(BUZZ_PLACE);
            return;
          }
          p.held = { kind: 'pot', pot };
          tile.pot = null;
          buzz(BUZZ_PICKUP);
          return;
        }
        this.usePot(p, pot, held, buzz);
        return;
      }

      case 'serve': {
        if (!held || held.kind !== 'plate' || held.contents.length === 0) return;
        const tier = this.serve(p, ti, held.contents);
        p.held = null;
        // A plate nobody ordered still leaves the hand, but it is not a win:
        // one flat pulse, no celebration.
        buzz(tier ? BUZZ_SERVE[tier] : BUZZ_PLACE);
        return;
      }

      case 'trash': {
        if (!held) return;
        if (held.kind === 'ingredient') {
          p.held = null;
          buzz(BUZZ_PLACE);
          return;
        }
        if (held.kind === 'pot') {
          // Pots are kitchen furniture: tip the contents out, keep the pot.
          if (held.pot.contents.length === 0 && held.pot.state === 'idle') return;
          Game.emptyPot(held.pot);
          buzz(BUZZ_PLACE);
          return;
        }
        if (held.kind !== 'plate') return; // the extinguisher is not rubbish
        if (held.contents.length === 0) return; // clean plate: nothing to bin
        held.contents = [];
        buzz(BUZZ_PLACE);
        return;
      }

      case 'extinguisher': {
        if (!held) {
          const mounted = tile.item;
          if (mounted?.kind !== 'extinguisher') return;
          p.held = mounted;
          tile.item = null;
          buzz(BUZZ_PICKUP);
          return;
        }
        // The bracket takes back exactly one thing.
        if (held.kind !== 'extinguisher' || tile.item) return;
        tile.item = held;
        p.held = null;
        buzz(BUZZ_PLACE);
        return;
      }

      case 'floor':
        return;
    }
  }

  /**
   * Score a delivered plate against the order queue (earliest match wins), and
   * post the celebration the TV plays. Returns how well it landed, or null
   * when nothing on the rail wanted this plate.
   */
  private serve(p: PlayerState, tileIndex: number, contents: readonly Ingredient[]): ServeTier | null {
    const s = this.snapshot;
    const parts = contents.map((c) => c.type);
    const i = s.orders.findIndex((o) => sameMultiset(o.recipe, parts));
    if (i < 0) return null; // no matching order: plate consumed, 0 points
    const order = s.orders[i];
    const frac = order.totalMs > 0 ? clamp(order.msLeft / order.totalMs, 0, 1) : 0;
    const points = SERVE_POINTS + Math.round(SERVE_TIME_BONUS_MAX * frac);
    const tier: ServeTier =
      frac >= TIER_PERFECT ? 'perfect' : frac >= TIER_GREAT ? 'great' : 'good';
    s.score += points;
    s.served++;
    // The rail is drawn right-aligned, so the slot a ticket occupied is its
    // distance from the right end — the one number that stays true after the
    // splice, and all the renderer needs to fly the ticket off.
    const slot = s.orders.length - 1 - i;
    s.orders.splice(i, 1);

    this.perfectStreak = tier === 'perfect' ? this.perfectStreak + 1 : 0;
    this.pushFx({
      id: this.nextFxId++,
      t: 'serve',
      at: s.elapsedMs,
      tile: { x: tileIndex % s.w, y: Math.floor(tileIndex / s.w) },
      playerId: p.id,
      color: p.color,
      dish: order.dish,
      points,
      tier,
      streak: tier === 'perfect' ? this.perfectStreak : 0,
      slot,
    });
    return tier;
  }

  // --- fx ------------------------------------------------------------------

  /** Append to the ring buffer, dropping the oldest once it is full. */
  private pushFx(ev: FxEvent): void {
    const fx = this.snapshot.fx;
    fx.push(ev);
    if (fx.length > FX_MAX) fx.splice(0, fx.length - FX_MAX);
  }

  /** Drop events the renderer has long finished with. */
  private pruneFx(): void {
    const fx = this.snapshot.fx;
    if (fx.length === 0) return;
    const cutoff = this.snapshot.elapsedMs - FX_TTL_MS;
    let keep = 0;
    while (keep < fx.length && fx[keep]!.at < cutoff) keep++;
    if (keep > 0) fx.splice(0, keep);
  }

  // --- chopping: button B, or button A with empty hands --------------------

  /** A board with something on it that still wants the knife. */
  private static choppable(tile: Tile): boolean {
    if (tile.t !== 'board' || tile.fire) return false;
    const item = tile.item;
    if (!item || item.kind !== 'ingredient') return false;
    return INGREDIENTS[item.ing.type].chop && !item.ing.chopped;
  }

  /** Index of the board this player could chop on right now, else null. */
  private chopTargetIndex(p: PlayerState): number | null {
    if (p.held?.kind === 'extinguisher') return null; // that hand is busy
    const ti = p.target;
    if (ti === null) return null;
    const tile = this.snapshot.tiles[ti];
    return tile && Game.choppable(tile) ? ti : null;
  }

  private actionB(rt: Runtime): void {
    // Holding the extinguisher, B is the trigger and nothing else: dashing
    // away mid-spray would be the opposite of what the button is for.
    if (rt.s.held?.kind === 'extinguisher') return;
    // Facing a choppable board => chop (handled while held). Otherwise dash.
    if (this.chopTargetIndex(rt.s) !== null) return;
    if (rt.s.dashMsLeft > 0 || rt.dashCooldownMs > 0) return;
    const d = rt.s.dir;
    const len = Math.hypot(d.x, d.y);
    rt.dashDir = len > 1e-4 ? { x: d.x / len, y: d.y / len } : { x: 0, y: 1 };
    rt.s.dashMsLeft = DASH_MS;
    rt.dashCooldownMs = DASH_MS + DASH_COOLDOWN_MS;
  }

  private stopChoppingAt(ti: number): void {
    for (const rt of this.rts.values()) {
      if (rt.s.chopping && rt.s.target === ti) rt.s.chopping = false;
    }
  }

  /** Is this chef leaning on a chop button? B always, A only empty-handed. */
  private static chopHeld(rt: Runtime): boolean {
    return rt.bDown || (rt.aDown && rt.s.held === null);
  }

  private updateChopping(dt: number, events: BuzzEvent[]): void {
    const advanced = new Set<number>();
    for (const rt of this.rts.values()) {
      const p = rt.s;
      if (!Game.chopHeld(rt)) {
        p.chopping = false;
        continue;
      }
      const ti = this.chopTargetIndex(p);
      if (ti === null) {
        p.chopping = false;
        continue;
      }
      p.chopping = true;
      if (advanced.has(ti)) continue; // two chefs on one board is not a speedup
      advanced.add(ti);

      const tile = this.snapshot.tiles[ti];
      const item = tile.item;
      if (!item || item.kind !== 'ingredient') continue;
      tile.chopMs = (tile.chopMs ?? 0) + dt;
      if (tile.chopMs >= CHOP_MS) {
        item.ing.chopped = true;
        tile.chopMs = 0;
        // Everyone working this board stops and feels the finish.
        for (const other of this.rts.values()) {
          if (other.s.chopping && other.s.target === ti) {
            other.s.chopping = false;
            events.push({ playerId: other.s.id, buzzMs: BUZZ_CHOP_DONE });
          }
        }
      }
    }
  }

  /**
   * The extinguisher, held down. Foam always sprays (a dead trigger reads as
   * a broken button); a fire in front of it goes out after EXTINGUISH_MS.
   * Two chefs on one fire is not a speedup, exactly as with chopping.
   */
  private updateSpraying(dt: number, events: BuzzEvent[]): void {
    const advanced = new Set<number>();
    for (const rt of this.rts.values()) {
      const p = rt.s;
      if (!rt.bDown || p.held?.kind !== 'extinguisher') {
        p.spraying = false;
        continue;
      }
      p.spraying = true;
      const ti = p.target;
      if (ti === null) continue;
      const tile = this.snapshot.tiles[ti];
      if (!tile?.fire || advanced.has(ti)) continue;
      advanced.add(ti);
      tile.fire.sprayMs += dt;
      if (tile.fire.sprayMs < EXTINGUISH_MS) continue;
      delete tile.fire;
      for (const other of this.rts.values()) {
        if (other.s.spraying && other.s.target === ti) {
          events.push({ playerId: other.s.id, buzzMs: BUZZ_FIRE_OUT });
        }
      }
    }
  }

  // --- movement + collision ------------------------------------------------

  private moveAndCollide(dt: number): void {
    const secs = dt / 1000;
    for (const rt of this.rts.values()) {
      const p = rt.s;
      let vx: number;
      let vy: number;
      if (p.dashMsLeft > 0) {
        vx = rt.dashDir.x * DASH_SPEED;
        vy = rt.dashDir.y * DASH_SPEED;
      } else {
        vx = rt.move.x * PLAYER_SPEED;
        vy = rt.move.y * PLAYER_SPEED;
      }
      p.pos.x += vx * secs;
      p.pos.y += vy * secs;
    }

    for (let pass = 0; pass < COLLISION_PASSES; pass++) {
      for (const rt of this.rts.values()) this.resolveTiles(rt.s);
      this.resolvePlayers();
    }
    for (const rt of this.rts.values()) this.resolveTiles(rt.s);
  }

  /** Circle vs solid-tile AABB pushout. */
  private resolveTiles(p: PlayerState): void {
    const r = PLAYER_RADIUS;
    const s = this.snapshot;
    const minX = Math.floor(p.pos.x - r - 0.5);
    const maxX = Math.ceil(p.pos.x + r + 0.5);
    const minY = Math.floor(p.pos.y - r - 0.5);
    const maxY = Math.ceil(p.pos.y + r + 0.5);

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const tile = this.tileAt(tx, ty);
        if (tile && tile.t === 'floor') continue;
        // Out of bounds counts as solid so nobody can leave the kitchen.
        const left = tx - 0.5;
        const right = tx + 0.5;
        const top = ty - 0.5;
        const bottom = ty + 0.5;
        const cx = clamp(p.pos.x, left, right);
        const cy = clamp(p.pos.y, top, bottom);
        const dx = p.pos.x - cx;
        const dy = p.pos.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;

        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = r - d;
          p.pos.x += (dx / d) * push;
          p.pos.y += (dy / d) * push;
        } else {
          // Centre is inside the box: leave via the shallowest face.
          const dl = p.pos.x - left;
          const dr = right - p.pos.x;
          const dt2 = p.pos.y - top;
          const db = bottom - p.pos.y;
          const m = Math.min(dl, dr, dt2, db);
          if (m === dl) p.pos.x = left - r;
          else if (m === dr) p.pos.x = right + r;
          else if (m === dt2) p.pos.y = top - r;
          else p.pos.y = bottom + r;
        }
      }
    }

    p.pos.x = clamp(p.pos.x, -0.5, s.w - 0.5);
    p.pos.y = clamp(p.pos.y, -0.5, s.h - 0.5);
  }

  /** Soft player-vs-player separation. */
  private resolvePlayers(): void {
    const list = this.snapshot.players;
    const min = PLAYER_RADIUS * 2;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        let dx = b.pos.x - a.pos.x;
        let dy = b.pos.y - a.pos.y;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1e-6) {
          // Perfectly stacked: separate deterministically by index.
          dx = (i % 2 === 0 ? 1 : -1) * 1e-3;
          dy = 1e-3;
          d = Math.hypot(dx, dy);
        }
        const push = ((min - d) / 2) * PLAYER_PUSH;
        const nx = (dx / d) * push;
        const ny = (dy / d) * push;
        a.pos.x -= nx;
        a.pos.y -= ny;
        b.pos.x += nx;
        b.pos.y += ny;
      }
    }
  }
}
