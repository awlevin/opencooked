// Snapshot buffering + interpolation.
//
// The server broadcasts at ~20 Hz; we render at display rate. To avoid
// stutter we render the world slightly in the past (one snapshot interval
// plus a small cushion) and lerp between the two most recent snapshots.

import { SNAPSHOT_MS, type HeldItem, type Snapshot } from '@/shared/types';

/** How far behind "now" we render, in ms. One packet + a cushion. */
const INTERP_DELAY_MS = SNAPSHOT_MS + 20;

export interface RenderPlayer {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  /** Smoothed facing angle in radians (0 = +x, screen space). */
  angle: number;
  held: HeldItem | null;
  chopping: boolean;
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
    let alpha = 1;
    if (prev) {
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
        held: p.held,
        chopping: p.chopping,
        dashing: p.dashMsLeft > 0,
        dashT: p.dashMsLeft > 0 ? Math.min(1, p.dashMsLeft / 150) : 0,
        local: this.localCheck(p.id),
      };
    });

    for (const id of this.angles.keys()) {
      if (!live.has(id)) this.angles.delete(id);
    }

    // `age` only smooths the countdowns between packets. Cap it so a stalled
    // socket cannot run the round clock and order bars down to zero.
    const age = clamp(now - cur.t, 0, 400);
    return { snap: cur.s, players, age };
  }
}
