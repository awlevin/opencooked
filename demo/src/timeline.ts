// Where every beat of the edit falls. Derived from the capture's meta.json so
// a fresh take re-cuts itself instead of drifting out of sync with the labels.

import meta from '../captures/meta.json';

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const sec = (s: number): number => Math.round(s * FPS);

export const TITLE_S = 4.2;
export const HOW_S = 5.2;
export const GAMEPLAY_S = 33;
export const OUTRO_S = 5;
/** Scenes overlap by this much, and the cross-fade lives inside the overlap. */
export const FADE_S = 0.45;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Beat {
  t: number;
  x: number;
  y: number;
}

export interface Meta {
  roundStart: number;
  serves: number[];
  chops: Beat[];
  cooks: Beat[];
  gridW: number;
  gridH: number;
  serveTile: { x: number; y: number };
  hostDuration: number;
  phoneDuration: number;
  hostWidth: number;
  hostHeight: number;
  phoneWidth: number;
  phoneHeight: number;
  phoneEvents: Array<{ t: number; kind: 'move' | 'grab' }>;
  phoneStick: Box;
  phoneGrab: Box;
  finalScore: number;
  finalServed: number;
  takes: number;
  room: string;
}

export const META = meta as Meta;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The gameplay window inside host.mp4. Anchored so the last serve we caught
 * lands ~2.5 s before the cut — that is what makes the segment feel like it
 * builds to something instead of just stopping.
 */
export const GAMEPLAY_START = (() => {
  const lastServe = META.serves[META.serves.length - 1] ?? META.roundStart + 20;
  const latest = Math.max(0, META.hostDuration - GAMEPLAY_S);
  return clamp(lastServe + 2.5 - GAMEPLAY_S, Math.min(META.roundStart + 0.5, latest), latest);
})();

export interface Callout {
  /** Seconds into the gameplay scene. */
  at: number;
  text: string;
  tint: string;
  /** Tile the label points at. */
  tile: { x: number; y: number };
  /** Label sits below the tile with the stalk on top (used for the top row). */
  flip: boolean;
}

/** A beat inside [from, to] of the scene; `last` takes the latest one instead. */
const pickBeat = (
  beats: Beat[],
  from: number,
  to: number,
  last = false,
): (Beat & { at: number }) | null => {
  const inRange = beats
    .map((b) => ({ ...b, at: b.t - GAMEPLAY_START }))
    .filter((b) => b.at >= from && b.at <= to);
  return (last ? inRange[inRange.length - 1] : inRange[0]) ?? null;
};

const pickTime = (times: number[], from: number, to: number): number | null => {
  for (const t of times) {
    const at = t - GAMEPLAY_START;
    if (at >= from && at <= to) return at;
  }
  return null;
};

/**
 * Three labels across the whole segment, each pinned to the exact station the
 * thing happened on and spaced far enough apart to stay calm.
 */
export const CALLOUTS: Callout[] = (() => {
  // The serve is the anchor; the other two walk backwards from it so the
  // labels always read chop -> cook -> serve, in that order.
  const serveAt = pickTime(META.serves, 3, GAMEPLAY_S - 2.5) ?? GAMEPLAY_S - 3;
  const cook = pickBeat(META.cooks, 2, serveAt - 3.5);
  const chop = pickBeat(META.chops, 1.2, (cook?.at ?? serveAt) - 2, true);
  const out: Callout[] = [];
  if (chop) {
    out.push({ at: chop.at, text: 'Chop', tint: '#ffd23f', tile: chop, flip: false });
  }
  if (cook) {
    // Stoves live on the top row, right under the HUD: hang the label below.
    out.push({ at: cook.at, text: 'Cook', tint: '#e8503a', tile: cook, flip: true });
  }
  out.push({ at: serveAt, text: 'Serve!', tint: '#2ec4a0', tile: META.serveTile, flip: false });
  return out;
})();

/** Phone gestures relative to the gameplay scene, for the controller highlight. */
const PHONE_BEATS = META.phoneEvents
  .map((e) => ({ ...e, at: e.t - GAMEPLAY_START }))
  .filter((e) => e.at > 0 && e.at < GAMEPLAY_S - 2);

/** The first joystick push and the first GRAB we can point a ring at. */
export const FIRST_MOVE = PHONE_BEATS.find((e) => e.kind === 'move' && e.at > 2.5)?.at ?? null;
export const FIRST_GRAB =
  PHONE_BEATS.find((e) => e.kind === 'grab' && e.at > (FIRST_MOVE ?? 0) + 3)?.at ?? null;

export const TOTAL_S = TITLE_S + HOW_S + GAMEPLAY_S + OUTRO_S - 3 * FADE_S;
export const TOTAL_FRAMES = sec(TOTAL_S);

export const SCENE_STARTS = {
  title: 0,
  how: TITLE_S - FADE_S,
  gameplay: TITLE_S + HOW_S - 2 * FADE_S,
  outro: TITLE_S + HOW_S + GAMEPLAY_S - 3 * FADE_S,
};
