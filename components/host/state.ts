// Snapshot buffering + interpolation.
//
// The server broadcasts at ~20 Hz; we render at display rate. To avoid
// stutter we render the world slightly in the past (one snapshot interval
// plus a small cushion) and lerp between the two most recent snapshots.

import { SNAPSHOT_MS, type HeldItem, type Snapshot } from '@/shared/types';

/** How far behind "now" we render, in ms. One packet + a cushion. */
const INTERP_DELAY_MS = SNAPSHOT_MS + 20;

/**
 * The station a chef is aiming at, eased. The sim decides *which* tile (it is
 * `PlayerState.target`, the one the next press acts on); all that happens here
 * is the easing, so the highlight glides to the counter next door and fades
 * away instead of popping on and off between packets.
 */
export interface AimView {
  /** Tile index, so two chefs on one counter can be drawn as two chefs. */
  idx: number;
  /** Tile coordinates, eased — the highlight slides rather than jumps. */
  x: number;
  y: number;
  /** 0..1 fade-in. */
  a: number;
}

export interface RenderPlayer {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  /** Smoothed facing angle in radians (0 = +x, screen space). */
  angle: number;
  /** What the sim says this chef's next press will land on, eased. */
  aim: AimView | null;
  held: HeldItem | null;
  chopping: boolean;
  /** Holding the extinguisher trigger (the renderer draws the foam). */
  spraying: boolean;
  dashing: boolean;
  /** 0..1, how far into the dash we are (for squash/stretch). */
  dashT: number;
  /** This chef's phone is wired straight into this tab (local mode). */
  local: boolean;
}

export interface Frame {
  snap: Snapshot;
  players: RenderPlayer[];
  /** ms elapsed since the newest snapshot arrived (for local countdowns). */
  age: number;
}

interface Stamped {
  s: Snapshot;
  t: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** Frame-rate independent approach factor: `rate` is roughly 1/seconds. */
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

/** Shortest-arc interpolation between two angles. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class SnapshotBuffer {
  private prev: Stamped | null = null;
  private cur: Stamped | null = null;
  /** Persistent per-player facing so rotation eases instead of snapping. */
  private angles = new Map<string, number>();
  /** Persistent per-player aim, so the target highlight glides and fades. */
  private aims = new Map<string, AimView>();
  private lastSampleAt = 0;
  /** Asked per frame, so the badge is never a stale copy of the truth. */
  private localCheck: (playerId: string) => boolean = () => false;

  /** Tell the renderer which chefs are on a direct peer connection. */
  setLocalCheck(fn: (playerId: string) => boolean): void {
    this.localCheck = fn;
  }

  push(s: Snapshot): void {
    const t = performance.now();
    // Guard against out-of-order / duplicate timestamps.
    if (this.cur && t <= this.cur.t) {
      this.cur = { s, t: this.cur.t + 1 };
    } else {
      this.prev = this.cur;
      this.cur = { s, t };
    }
  }

  clear(): void {
    this.prev = null;
    this.cur = null;
    this.angles.clear();
    this.aims.clear();
  }

  get latest(): Snapshot | null {
    return this.cur?.s ?? null;
  }

  /** Interpolated view of the world for the given frame time. */
  sample(now: number): Frame | null {
    const cur = this.cur;
    if (!cur) return null;

    const dt = this.lastSampleAt ? Math.min(0.1, (now - this.lastSampleAt) / 1000) : 0;
    this.lastSampleAt = now;

    const prev = this.prev;
    // A paused kitchen is a still photograph: interpolating toward it would
    // let chefs drift a few centimetres under the overlay, which reads as the
    // freeze not having taken.
    let alpha = 1;
    if (prev && !cur.s.paused) {
      const span = cur.t - prev.t;
      if (span > 0) {
        alpha = (now - INTERP_DELAY_MS - prev.t) / span;
        alpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
      }
    }

    const prevById = new Map<string, (typeof cur.s.players)[number]>();
    if (prev) for (const p of prev.s.players) prevById.set(p.id, p);

    const live = new Set<string>();
    const players: RenderPlayer[] = cur.s.players.map((p) => {
      live.add(p.id);
      const o = prevById.get(p.id);
      // Big jumps (respawn / teleport) should not be interpolated.
      const far =
        o !== undefined &&
        Math.abs(o.pos.x - p.pos.x) + Math.abs(o.pos.y - p.pos.y) > 3;
      const use = o && !far ? o : p;
      const x = lerp(use.pos.x, p.pos.x, alpha);
      const y = lerp(use.pos.y, p.pos.y, alpha);

      const target =
        p.dir.x === 0 && p.dir.y === 0
          ? (this.angles.get(p.id) ?? Math.PI / 2)
          : Math.atan2(p.dir.y, p.dir.x);
      const held = this.angles.get(p.id);
      // Critically-damped-ish ease so turning reads smooth, not snappy.
      const angle =
        held === undefined ? target : lerpAngle(held, target, 1 - Math.exp(-dt * 20));
      this.angles.set(p.id, angle);

      return {
        id: p.id,
        name: p.name,
        color: p.color,
        x,
        y,
        angle,
        aim: this.aimOf(p.id, p.target, cur.s.w, dt),
        held: p.held,
        chopping: p.chopping,
        spraying: p.spraying === true,
        dashing: p.dashMsLeft > 0,
        dashT: p.dashMsLeft > 0 ? Math.min(1, p.dashMsLeft / 150) : 0,
        local: this.localCheck(p.id),
      };
    });

    for (const id of this.angles.keys()) {
      if (!live.has(id)) this.angles.delete(id);
    }
    for (const id of this.aims.keys()) {
      if (!live.has(id)) this.aims.delete(id);
    }

    // `age` only smooths the countdowns between packets. Cap it so a stalled
    // socket cannot run the round clock and order bars down to zero. Paused,
    // nothing is counting down, so the caller gets a real age (the pause
    // overlay animates from it) and is expected not to spend it on clocks.
    const age = clamp(now - cur.t, 0, 400);
    return { snap: cur.s, players, age };
  }

  /**
   * Ease one chef's target highlight. The tile is the sim's; the glide and the
   * fade are ours, and both are frame-rate independent so a 60 Hz laptop and a
   * 120 Hz one look the same.
   */
  private aimOf(id: string, target: number | null, w: number, dt: number): AimView | null {
    let aim = this.aims.get(id);
    if (target !== null && w > 0) {
      const tx = target % w;
      const ty = Math.floor(target / w);
      if (!aim) {
        aim = { idx: target, x: tx, y: ty, a: 0 };
        this.aims.set(id, aim);
      } else if (aim.idx !== target) {
        // The ring never travels between tiles. Sliding it looked charming in
        // motion and wrong in a single frame — half of it over one counter and
        // half over the next, which is exactly the ambiguity this whole
        // feature exists to remove. So it moves outright and dips instead,
        // and the re-brightening below reads as the move.
        aim.idx = target;
        aim.x = tx;
        aim.y = ty;
        aim.a = Math.min(aim.a, 0.4);
      }
      aim.a = lerp(aim.a, 1, ease(dt, 18));
    } else if (aim) {
      aim.a = lerp(aim.a, 0, ease(dt, 11));
    }
    // Below a whisker of alpha there is nothing to draw, and saying so here
    // keeps the "is anyone aiming at this tile" test in the renderer trivial.
    return aim && aim.a > 0.02 ? aim : null;
  }
}
