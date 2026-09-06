// Celebrations. Everything the TV does when a dish lands, scaled by how early
// it landed: `good` gets a score popup and a puff, `great` adds a word, a ring
// and a bump on the score, `perfect` adds confetti, a starburst, a flash and a
// halo on the chef who ran it.
//
// Two rules shape the whole module.
//
// 1. **No state.** Every particle's angle, speed, spin and colour is a pure
//    function of `(event.id, index)` through `rnd` below, and its position is a
//    pure function of the event's age. So there is nothing to allocate per
//    frame, nothing to pool, nothing to reset, and a TV that only just started
//    receiving snapshots plays the same celebration as one that has been
//    watching all round. The only per-frame allocation in here is the radial
//    gradient for the perfect-serve flash, which exists for 250 ms a serve.
//
// 2. **Never over the tickets.** The order rail is the one thing on screen a
//    player is reading under time pressure. Board-space effects are clipped to
//    the play area and the popup is clamped below the HUD band; the only thing
//    that touches the rail is the served ticket leaving it, drawn by the HUD.

import type { FxEvent, Snapshot } from '@/shared/types';
import { STREAK_ON_FIRE } from '@/shared/types';
import { PAL, circle, clamp, rr, text, worldToPx } from './theme';

/** Where the kitchen ended up this frame, in CSS pixels. */
export interface FxLayout {
  W: number;
  H: number;
  /** 1 = a 1920x1080 screen. */
  u: number;
  hudH: number;
  /** Top-left of the board, its size, and one tile in pixels. */
  bx: number;
  by: number;
  bw: number;
  bh: number;
  T: number;
}

const POPUP_MS = 1400;
const WORD_MS = 1500;
const SPARK_MS = 900;
const RING_MS = 620;
const BURST_MS = 520;
const CONFETTI_MS = 1800;
const FLASH_MS = 250;
const HALO_MS = 600;
const BUMP_MS = 420;
const SPIN_MS = 700;
/** How long the served ticket takes to leave the rail. */
export const TICKET_EXIT_MS = 420;

/** Longest any of the above runs. Older events are skipped outright. */
const DRAW_MS = 2000;

/**
 * A deterministic [0,1) from an event id and a particle index. One integer
 * hash, no allocation, and the same answer on every screen in the room.
 */
function rnd(id: number, i: number): number {
  let t = (Math.imul(id, 374761393) + Math.imul(i, 668265263)) | 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/** 0 -> 1 fast, settling. */
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

/** Rises to 1 and comes back to 0 — one beat, for bumps and flashes. */
const beat = (t: number): number => Math.sin(clamp(t, 0, 1) * Math.PI);

/** Overshoot-and-settle, for a word arriving. */
function popIn(t: number): number {
  if (t >= 1) return 1;
  const u = 1 - clamp(t, 0, 1);
  return 1 + 2.4 * u * u * u - 3.2 * u * u;
}

/** The clock every effect is measured against: sim ms, smoothed by the frame. */
export function fxNow(snap: Snapshot, age: number): number {
  return snap.elapsedMs + (snap.paused ? 0 : age);
}

/** Age of an event in ms, or null when it is not worth drawing. */
function ageOf(ev: FxEvent, now: number): number | null {
  const age = now - ev.at;
  return age >= 0 && age < DRAW_MS ? age : null;
}

/** The word a tier shouts, or '' for the quiet one. */
function wordOf(ev: FxEvent): string {
  if (ev.streak >= STREAK_ON_FIRE) return 'ON FIRE!';
  if (ev.tier === 'perfect') return 'PERFECT!';
  if (ev.tier === 'great') return 'GREAT!';
  return '';
}

/**
 * How hard the HUD score should bounce right now: 0 = still, 1 = mid-bump.
 * Only `great` and `perfect` move it — a bump on every serve is a twitch.
 */
export function scoreBump(snap: Snapshot, now: number): number {
  let k = 0;
  for (const ev of snap.fx) {
    if (ev.tier === 'good') continue;
    const age = now - ev.at;
    if (age < 0 || age >= BUMP_MS) continue;
    const v = beat(age / BUMP_MS) * (ev.tier === 'perfect' ? 1 : 0.6);
    if (v > k) k = v;
  }
  return k;
}

/** One full turn of the HUD star for a perfect serve, in radians. */
export function starSpin(snap: Snapshot, now: number): number {
  let a = 0;
  for (const ev of snap.fx) {
    if (ev.tier !== 'perfect') continue;
    const age = now - ev.at;
    if (age < 0 || age >= SPIN_MS) continue;
    a = Math.max(a, easeOut(age / SPIN_MS) * Math.PI * 2);
  }
  return a;
}

/** 0..1 glow on the chef who just nailed one. Perfect serves only. */
export function chefGlow(snap: Snapshot, now: number, playerId: string): number {
  let g = 0;
  for (const ev of snap.fx) {
    if (ev.tier !== 'perfect' || ev.playerId !== playerId) continue;
    const age = now - ev.at;
    if (age < 0 || age >= HALO_MS) continue;
    g = Math.max(g, beat(age / HALO_MS));
  }
  return g;
}

/** A soft ring around a chef, drawn in board-local space under the chef. */
export function drawChefGlow(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  T: number,
  color: string,
  g: number,
): void {
  if (g <= 0.01) return;
  c.save();
  c.globalAlpha = g * 0.55;
  c.strokeStyle = color;
  c.lineWidth = T * 0.09;
  circle(c, x, y, T * (0.42 + 0.4 * (1 - g)));
  c.stroke();
  c.globalAlpha = g * 0.28;
  c.lineWidth = T * 0.05;
  circle(c, x, y, T * (0.56 + 0.7 * (1 - g)));
  c.stroke();
  c.restore();
}

/**
 * How far through its exit a just-served ticket is, 0..1, or -1 when this
 * event's ticket is not leaving the rail right now. A plain number rather
 * than a generator or a filtered list, so the HUD's per-frame loop over
 * `snap.fx` allocates nothing at all.
 */
export function ticketExit(ev: FxEvent, now: number): number {
  const age = now - ev.at;
  return age >= 0 && age < TICKET_EXIT_MS ? age / TICKET_EXIT_MS : -1;
}

/** Everything that happens over the kitchen itself. */
export function drawServeFx(
  c: CanvasRenderingContext2D,
  snap: Snapshot,
  now: number,
  L: FxLayout,
): void {
  if (snap.fx.length === 0) return;
  const { u, W, H, hudH } = L;

  // A warm flash for a perfect serve. Deliberately stops at the HUD band so
  // the order rail never dims: the tickets are the one thing being read.
  for (const ev of snap.fx) {
    if (ev.tier !== 'perfect') continue;
    const age = now - ev.at;
    if (age < 0 || age >= FLASH_MS) continue;
    const a = beat(age / FLASH_MS) * 0.15;
    // The one allocation per frame in this module, and only while a perfect
    // serve is flashing — 250 ms, a handful of frames.
    const grad = c.createRadialGradient(
      W / 2,
      (hudH + H) / 2,
      Math.min(W, H) * 0.25,
      W / 2,
      (hudH + H) / 2,
      Math.max(W, H) * 0.62,
    );
    grad.addColorStop(0, 'rgba(255, 210, 63, 0)');
    grad.addColorStop(1, `rgba(255, 168, 60, ${a.toFixed(3)})`);
    c.save();
    c.fillStyle = grad;
    c.fillRect(0, hudH, W, H - hudH);
    c.restore();
  }

  // Particles belong to the kitchen, so they are clipped to the tray: confetti
  // spilling onto the backdrop reads as debris, not celebration.
  c.save();
  rr(c, L.bx, L.by, L.bw, L.bh, u * 22);
  c.clip();
  for (const ev of snap.fx) {
    const age = ageOf(ev, now);
    if (age === null) continue;
    const x = L.bx + worldToPx(ev.tile.x, L.T);
    const y = L.by + worldToPx(ev.tile.y, L.T);
    drawRing(c, ev, age, x, y, L.T);
    drawBurst(c, ev, age, x, y, L.T);
    drawSparkles(c, ev, age, x, y, u);
    drawConfetti(c, ev, age, x, y, u);
  }
  c.restore();

  // The popup is text and has to stay readable, so it is free of the tray —
  // but never of the HUD band, which the order rail lives in.
  c.save();
  c.beginPath();
  c.rect(0, hudH, W, H - hudH);
  c.clip();
  for (const ev of snap.fx) {
    const age = ageOf(ev, now);
    if (age === null) continue;
    drawPopup(c, ev, age, L.bx + worldToPx(ev.tile.x, L.T), L.by + worldToPx(ev.tile.y, L.T), L);
  }
  c.restore();
}

/** A ring pushing out of the serve window. `great` and better. */
function drawRing(
  c: CanvasRenderingContext2D,
  ev: FxEvent,
  age: number,
  x: number,
  y: number,
  T: number,
): void {
  if (ev.tier === 'good' || age >= RING_MS) return;
  const t = age / RING_MS;
  c.save();
  c.globalAlpha = (1 - t) * 0.75;
  c.strokeStyle = ev.tier === 'perfect' ? PAL.butter : PAL.cream;
  c.lineWidth = T * 0.1 * (1 - t * 0.7);
  circle(c, x, y, T * (0.35 + easeOut(t) * 1.6));
  c.stroke();
  c.restore();
}

/** Twelve spokes of light. Perfect only. */
function drawBurst(
  c: CanvasRenderingContext2D,
  ev: FxEvent,
  age: number,
  x: number,
  y: number,
  T: number,
): void {
  if (ev.tier !== 'perfect' || age >= BURST_MS) return;
  const t = age / BURST_MS;
  const inner = T * (0.3 + easeOut(t) * 0.6);
  const outer = inner + T * 0.55 * (1 - t);
  c.save();
  c.globalAlpha = (1 - t) * 0.85;
  c.strokeStyle = PAL.butter;
  c.lineWidth = T * 0.055;
  c.lineCap = 'round';
  c.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rnd(ev.id, 900) * 0.5;
    c.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
    c.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
  }
  c.stroke();
  c.restore();
}

const SPARK_COLORS = [PAL.cream, PAL.butter, PAL.amber];

/** A puff of sparkles. Six for `good`, fourteen for `great` and up. */
function drawSparkles(
  c: CanvasRenderingContext2D,
  ev: FxEvent,
  age: number,
  x: number,
  y: number,
  u: number,
): void {
  if (age >= SPARK_MS) return;
  const n = ev.tier === 'good' ? 6 : 14;
  const t = age / SPARK_MS;
  const reach = u * (ev.tier === 'good' ? 90 : 140);
  c.save();
  c.globalAlpha = 1 - t * t;
  for (let i = 0; i < n; i++) {
    const a = rnd(ev.id, i) * Math.PI * 2;
    const speed = 0.45 + 0.55 * rnd(ev.id, i + 32);
    const d = easeOut(t) * reach * speed;
    const r = u * (7 + 6 * rnd(ev.id, i + 64)) * (1 - t * 0.7);
    // `good` stays cream; the louder tiers pick up butter and amber.
    c.fillStyle =
      ev.tier === 'good'
        ? PAL.cream
        : SPARK_COLORS[Math.floor(rnd(ev.id, i + 96) * SPARK_COLORS.length)]!;
    circle(c, x + Math.cos(a) * d, y + Math.sin(a) * d - easeOut(t) * u * 20, r);
    c.fill();
  }
  c.restore();
}

const CONFETTI = 30;

/** Tumbling paper in the chef's colour. Perfect only. */
function drawConfetti(
  c: CanvasRenderingContext2D,
  ev: FxEvent,
  age: number,
  x: number,
  y: number,
  u: number,
): void {
  if (ev.tier !== 'perfect' || age >= CONFETTI_MS) return;
  const secs = age / 1000;
  const life = age / CONFETTI_MS;
  c.save();
  c.globalAlpha = life < 0.7 ? 1 : (1 - life) / 0.3;
  for (let i = 0; i < CONFETTI; i++) {
    const a = -Math.PI / 2 + (rnd(ev.id, i + 128) - 0.5) * 2.4;
    const speed = u * (320 + 420 * rnd(ev.id, i + 160));
    // Plain ballistics: launch up and out, then gravity takes it.
    const px = x + Math.cos(a) * speed * secs;
    const py = y + Math.sin(a) * speed * secs + u * 900 * secs * secs;
    const spin = (rnd(ev.id, i + 192) - 0.5) * 18 * secs + rnd(ev.id, i + 224) * 6;
    const w = u * (9 + 7 * rnd(ev.id, i + 256));
    const h = w * 0.52;
    const pick = rnd(ev.id, i + 288);
    c.fillStyle = pick < 0.5 ? ev.color : pick < 0.78 ? PAL.butter : PAL.cream;
    c.save();
    c.translate(px, py);
    c.rotate(spin);
    // Squash on the spin axis so each piece reads as paper turning over.
    c.scale(1, Math.abs(Math.cos(spin * 1.7)) * 0.8 + 0.2);
    c.fillRect(-w / 2, -h / 2, w, h);
    c.restore();
  }
  c.restore();
}

/** `+N` rising out of the window, with the tier's word under it. */
function drawPopup(
  c: CanvasRenderingContext2D,
  ev: FxEvent,
  age: number,
  x: number,
  y: number,
  L: FxLayout,
): void {
  if (age >= POPUP_MS) return;
  const u = L.u;
  const t = age / POPUP_MS;
  // The chef who served is standing between the window and the room, so the
  // popup starts above their head and climbs hard: at 400 ms it is well clear.
  const rise = easeOut(t) * u * 200;
  // It may never climb into the order rail.
  const floor = L.hudH + u * 40;
  const py = Math.max(floor, y - L.T * 0.6 - rise);
  const alpha = t < 0.06 ? t / 0.06 : t > 0.72 ? (1 - t) / 0.28 : 1;
  const size = u * (ev.tier === 'perfect' ? 60 : ev.tier === 'great' ? 52 : 44);
  const scale = popIn(clamp(age / 180, 0, 1));

  c.save();
  c.globalAlpha = clamp(alpha, 0, 1);
  c.translate(x, py);
  c.scale(scale, scale);
  text(c, `+${ev.points}`, 0, 0, {
    size,
    fill: ev.color || PAL.cream,
    outline: PAL.ink,
    outlineWidth: size * 0.16,
  });

  const word = wordOf(ev);
  if (word && age < WORD_MS) {
    const wSize = u * 34;
    text(c, word, 0, size * 0.78, {
      size: wSize,
      // ON FIRE! is the streak, so it takes the hottest colour in the set.
      fill: ev.streak >= STREAK_ON_FIRE ? PAL.tomato : PAL.butter,
      outline: PAL.ink,
      outlineWidth: wSize * 0.18,
      letterSpacing: u * 3,
    });
  }
  c.restore();
}
