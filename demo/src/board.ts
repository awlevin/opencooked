// Tile -> spot on the captured frame.
//
// The host renderer letterboxes the kitchen under a fixed-height HUD
// (components/host/render/game.ts). Mirroring that here is what lets a
// "Serve!" label actually sit on the serve window instead of near it.

import { META } from './timeline.ts';

const HUD_H = 158;
const PAD = 18;

export interface Frac {
  x: number;
  y: number;
}

/** Centre of tile (tx, ty) as a fraction of the frame. */
export function tileFrac(tx: number, ty: number): Frac {
  const W = META.hostWidth;
  const H = META.hostHeight;
  const u = Math.min(W / 1920, H / 1080);
  const hud = HUD_H * u;
  const pad = PAD * u;
  const T = Math.min((W - pad * 2) / META.gridW, (H - hud - pad * 2) / META.gridH);
  const bx = Math.round((W - T * META.gridW) / 2);
  const by = Math.round(hud + (H - hud - T * META.gridH) / 2);
  return { x: (bx + (tx + 0.5) * T) / W, y: (by + (ty + 0.5) * T) / H };
}

/** Half a tile, as a fraction of frame height — how far to clear a station by. */
export function tileFracH(): number {
  const W = META.hostWidth;
  const H = META.hostHeight;
  const u = Math.min(W / 1920, H / 1080);
  const T = Math.min((W - PAD * 2 * u) / META.gridW, (H - HUD_H * u - PAD * 2 * u) / META.gridH);
  return T / H;
}
