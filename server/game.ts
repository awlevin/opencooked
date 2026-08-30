// Authoritative kitchen simulation.
//
// Pure and deterministic: no ws / express / timers in here. The transport
// layer (server/index.ts) owns the clock and calls tick(dtMs), then forwards
// the returned buzz events to the right phones.

import type { Btn } from '../shared/protocol';
import { createLevel } from '../shared/levels';
import type {
  IngredientType,
  Order,
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
  MAX_ORDERS,
  ORDER_MS,
  ORDER_SPAWN_MS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  POT_CAPACITY,
  ROUND_MS,
  SERVE_POINTS,
  SERVE_TIME_BONUS_MAX,
} from '../shared/types';

/** A haptic pulse the transport layer should forward to one controller. */
export interface BuzzEvent {
  playerId: string;
  buzzMs: number;
}

const BUZZ_PICKUP = 25;
const BUZZ_PLACE = 30;
const BUZZ_CHOP_DONE = 70;
const BUZZ_SERVE = 150;

/** Longest dt a single tick may integrate, so a stalled loop cannot teleport. */
const MAX_DT_MS = 250;
/** Collision relaxation passes per tick. */
const COLLISION_PASSES = 3;
/** Fraction of the overlap each player resolves per tick (soft pushout). */
const PLAYER_PUSH = 0.5;
/** Button edges buffered between ticks, per button, per player. */
const MAX_QUEUED_PRESSES = 4;

const INGREDIENTS: readonly IngredientType[] = ['onion', 'tomato', 'mushroom'];

/** Per-player state that is not part of the wire snapshot. */
interface Runtime {
  s: PlayerState;
  move: Vec2;
  aPresses: number;
  bPresses: number;
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

/** Multiset equality on two ingredient lists (order-insensitive). */
function sameMultiset(a: readonly IngredientType[], b: readonly IngredientType[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

export interface GameOptions {
  /** Seed the recipe RNG for reproducible runs (tests). */
  seed?: number;
}

export class Game {
  /** Live snapshot; mutated in place and safe to JSON.stringify each frame. */
  readonly snapshot: Snapshot;

  private readonly rts = new Map<string, Runtime>();
  private readonly rand: () => number;
  private spawns: Vec2[];
  private orderTimerMs = 0;
  private nextOrderId = 1;

  constructor(opts: GameOptions = {}) {
    this.rand = mulberry32(opts.seed ?? ((Math.random() * 0xffffffff) >>> 0));
    const level = createLevel();
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
      msLeft: ROUND_MS,
      phase: 'lobby',
    };
  }

  get phase(): Phase {
    return this.snapshot.phase;
  }

  get playerCount(): number {
    return this.rts.size;
  }

  // --- lifecycle -----------------------------------------------------------

  /** Begin a round: fresh kitchen, fresh orders, everyone back on a spawn. */
  start(): void {
    this.resetWorld('playing');
    this.spawnOrder();
  }

  /** Return to the lobby (Play Again): fresh kitchen, no orders, no clock. */
  toLobby(): void {
    this.resetWorld('lobby');
  }

  private resetWorld(phase: Phase): void {
    const level = createLevel();
    this.spawns = level.spawns;
    const s = this.snapshot;
    s.w = level.w;
    s.h = level.h;
    s.tiles = level.tiles;
    s.orders = [];
    s.score = 0;
    s.served = 0;
    s.missed = 0;
    s.msLeft = ROUND_MS;
    s.phase = phase;
    this.orderTimerMs = 0;
    this.nextOrderId = 1;

    let i = 0;
    for (const rt of this.rts.values()) {
      const spawn = level.spawns[i % level.spawns.length];
      i++;
      rt.s.pos = { x: spawn.x, y: spawn.y };
      rt.s.dir = { x: 0, y: 1 };
      rt.s.held = null;
      rt.s.chopping = false;
      rt.s.dashMsLeft = 0;
      rt.move = { x: 0, y: 0 };
      rt.aPresses = 0;
      rt.bPresses = 0;
      rt.bDown = false;
      rt.dashCooldownMs = 0;
      rt.dashDir = { x: 0, y: 1 };
    }
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
      dashMsLeft: 0,
    };
    this.rts.set(id, {
      s,
      move: { x: 0, y: 0 },
      aPresses: 0,
      bPresses: 0,
      bDown: false,
      dashCooldownMs: 0,
      dashDir: { x: 0, y: 1 },
    });
    this.snapshot.players.push(s);
    return s;
  }

  removePlayer(id: string): void {
    if (!this.rts.delete(id)) return;
    const i = this.snapshot.players.findIndex((p) => p.id === id);
    if (i >= 0) this.snapshot.players.splice(i, 1);
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
    if (btn === 'a') rt.aPresses = Math.min(rt.aPresses + 1, MAX_QUEUED_PRESSES);
    else {
      rt.bPresses = Math.min(rt.bPresses + 1, MAX_QUEUED_PRESSES);
      rt.bDown = true;
    }
  }

  release(id: string, btn: Btn): void {
    const rt = this.rts.get(id);
    if (!rt) return;
    if (btn === 'b') rt.bDown = false;
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
    s.msLeft = Math.max(0, s.msLeft - dt);
    this.updateOrders(dt);
    this.updatePots(dt);

    // Facing follows the last nonzero stick direction.
    for (const rt of this.rts.values()) {
      const len = Math.hypot(rt.move.x, rt.move.y);
      if (len > 1e-4) rt.s.dir = { x: rt.move.x / len, y: rt.move.y / len };
      rt.s.dashMsLeft = Math.max(0, rt.s.dashMsLeft - dt);
      rt.dashCooldownMs = Math.max(0, rt.dashCooldownMs - dt);
    }

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
    this.moveAndCollide(dt);

    if (s.msLeft <= 0) s.phase = 'gameover';
    return events;
  }

  // --- orders --------------------------------------------------------------

  private randomRecipe(): IngredientType[] {
    const recipe: IngredientType[] = [];
    for (let i = 0; i < POT_CAPACITY; i++) {
      recipe.push(INGREDIENTS[Math.floor(this.rand() * INGREDIENTS.length) % INGREDIENTS.length]);
    }
    recipe.sort();
    return recipe;
  }

  private spawnOrder(): void {
    if (this.snapshot.orders.length >= MAX_ORDERS) return;
    const order: Order = {
      id: this.nextOrderId++,
      recipe: this.randomRecipe(),
      msLeft: ORDER_MS,
      totalMs: ORDER_MS,
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
    while (this.orderTimerMs >= ORDER_SPAWN_MS) {
      this.orderTimerMs -= ORDER_SPAWN_MS;
      this.spawnOrder();
    }
  }

  // --- pots ----------------------------------------------------------------

  private updatePots(dt: number): void {
    for (const tile of this.snapshot.tiles) {
      const pot = tile.pot;
      if (!pot) continue;
      if (pot.state === 'cooking') {
        // Only a full pot actually cooks (COOK_MS is "full pot -> done").
        if (pot.contents.length >= POT_CAPACITY) {
          pot.cookMs += dt;
          if (pot.cookMs >= COOK_MS) {
            pot.state = 'done';
            pot.cookMs = 0;
          }
        }
      } else if (pot.state === 'done') {
        pot.cookMs += dt;
        if (pot.cookMs >= BURN_MS) {
          pot.state = 'burnt';
          pot.cookMs = 0;
        }
      }
    }
  }

  private static emptyPot(pot: Pot): void {
    pot.contents = [];
    pot.cookMs = 0;
    pot.state = 'idle';
  }

  // --- tiles / targeting ---------------------------------------------------

  private tileAt(x: number, y: number): Tile | null {
    const s = this.snapshot;
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) return null;
    return s.tiles[y * s.w + x];
  }

  /** Tile one step in front of the player: round(pos + dir), clamped. */
  private targetIndex(p: PlayerState): number {
    const s = this.snapshot;
    const tx = clamp(Math.round(p.pos.x + p.dir.x), 0, s.w - 1);
    const ty = clamp(Math.round(p.pos.y + p.dir.y), 0, s.h - 1);
    return ty * s.w + tx;
  }

  // --- button A: grab / put ------------------------------------------------

  private actionA(rt: Runtime, events: BuzzEvent[]): void {
    const p = rt.s;
    const ti = this.targetIndex(p);
    const tile = this.snapshot.tiles[ti];
    if (!tile) return;
    const held = p.held;
    const buzz = (ms: number) => events.push({ playerId: p.id, buzzMs: ms });

    switch (tile.t) {
      case 'crate': {
        if (held || !tile.crate) return;
        p.held = { kind: 'ingredient', ing: { type: tile.crate, chopped: false } };
        buzz(BUZZ_PICKUP);
        return;
      }

      case 'plates': {
        if (held) return;
        p.held = { kind: 'plate', soup: null };
        buzz(BUZZ_PICKUP);
        return;
      }

      case 'counter':
      case 'board': {
        if (!held) {
          const item = tile.item;
          if (!item) return;
          p.held = item;
          tile.item = null;
          if (tile.t === 'board') {
            tile.chopMs = 0; // picking up aborts chop progress
            this.stopChoppingAt(ti);
          }
          buzz(BUZZ_PICKUP);
          return;
        }
        if (tile.item) return;
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
        if (!pot) return;
        if (!held) {
          if (pot.state !== 'burnt') return;
          Game.emptyPot(pot);
          buzz(BUZZ_PLACE);
          return;
        }
        if (held.kind === 'ingredient') {
          if (!held.ing.chopped) return;
          if (pot.state === 'done' || pot.state === 'burnt') return;
          if (pot.contents.length >= POT_CAPACITY) return;
          pot.contents.push(held.ing.type);
          pot.state = 'cooking';
          p.held = null;
          buzz(BUZZ_PLACE);
          return;
        }
        // Empty plate on a finished pot: scoop the soup.
        if (held.soup !== null) return;
        if (pot.state !== 'done') return;
        held.soup = pot.contents.slice();
        Game.emptyPot(pot);
        buzz(BUZZ_PLACE);
        return;
      }

      case 'serve': {
        if (!held || held.kind !== 'plate' || held.soup === null) return;
        this.serve(held.soup);
        p.held = null;
        buzz(BUZZ_SERVE);
        return;
      }

      case 'trash': {
        if (!held) return;
        if (held.kind === 'ingredient') {
          p.held = null;
          buzz(BUZZ_PLACE);
          return;
        }
        if (held.soup === null) return; // clean plate: nothing to bin
        held.soup = null;
        buzz(BUZZ_PLACE);
        return;
      }

      case 'floor':
        return;
    }
  }

  /** Score a delivered soup against the order queue (earliest match wins). */
  private serve(soup: IngredientType[]): void {
    const s = this.snapshot;
    const i = s.orders.findIndex((o) => sameMultiset(o.recipe, soup));
    if (i < 0) return; // no matching order: plate consumed, 0 points
    const order = s.orders[i];
    const frac = order.totalMs > 0 ? clamp(order.msLeft / order.totalMs, 0, 1) : 0;
    s.score += SERVE_POINTS + Math.round(SERVE_TIME_BONUS_MAX * frac);
    s.served++;
    s.orders.splice(i, 1);
  }

  // --- button B: chop / dash -----------------------------------------------

  /** Index of the board this player could chop on right now, else null. */
  private chopTargetIndex(p: PlayerState): number | null {
    const ti = this.targetIndex(p);
    const tile = this.snapshot.tiles[ti];
    if (!tile || tile.t !== 'board') return null;
    const item = tile.item;
    if (!item || item.kind !== 'ingredient' || item.ing.chopped) return null;
    return ti;
  }

  private actionB(rt: Runtime): void {
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
      if (rt.s.chopping && this.targetIndex(rt.s) === ti) rt.s.chopping = false;
    }
  }

  private updateChopping(dt: number, events: BuzzEvent[]): void {
    const advanced = new Set<number>();
    for (const rt of this.rts.values()) {
      const p = rt.s;
      if (!rt.bDown) {
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
          if (other.s.chopping && this.targetIndex(other.s) === ti) {
            other.s.chopping = false;
            events.push({ playerId: other.s.id, buzzMs: BUZZ_CHOP_DONE });
          }
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
