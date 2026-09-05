// Top bar: score, round clock, and the order queue as little paper tickets.
// Sized off `u` (1 = a 1920x1080 screen) so text stays couch-legible.

import type { Order, Snapshot } from '@/shared/types';
import { drawTicketIcon } from './ingredients';
import { PAL, clamp, fillStroke, font, rr, text } from './theme';

export interface HudLayout {
  W: number;
  H: number;
  u: number;
  hudH: number;
}

/**
 * One typographic system for both HUD groups: a small tracked caption, and a
 * big outlined figure under it, left edges on the same x. Every number in the
 * bar uses the same outline ratio so none of them reads heavier than another.
 */
const CAP_SIZE = 24; // caption size, in `u`
const CAP_TRACK = 6; // caption letter-spacing, in `u`
const CAP_FILL = 'rgba(255, 246, 227, 0.62)';
/** Outline width as a fraction of the font size. */
const OUTLINE = 0.09;

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The alphabetic baseline to draw `s` on so its *ink* is centred on `cy`.
 * Canvas' own baselines centre the em box, which for all-caps and digits
 * sits visibly low; every HUD figure is placed on its ink instead, which is
 * what makes the star, the caption and the number share one axis.
 * Callers must pass `baseline: 'alphabetic'`.
 */
function inkY(
  c: CanvasRenderingContext2D,
  s: string,
  size: number,
  cy: number,
  weight = 800,
): number {
  c.font = font(size, weight);
  const m = c.measureText(s);
  return cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
}

/** Width of `s` at a given size — for laying out before drawing. */
function widthOf(
  c: CanvasRenderingContext2D,
  s: string,
  size: number,
  weight = 800,
  tracking = 0,
): number {
  c.save();
  c.font = font(size, weight);
  (c as unknown as { letterSpacing: string }).letterSpacing = `${tracking}px`;
  const w = c.measureText(s).width;
  c.restore();
  return w;
}

/** Small tracked caption. `x` is the left edge (or centre when centred). */
function caption(
  c: CanvasRenderingContext2D,
  s: string,
  x: number,
  cy: number,
  u: number,
  fill = CAP_FILL,
  align: CanvasTextAlign = 'left',
): void {
  const track = u * CAP_TRACK;
  text(c, s, align === 'center' ? x + track / 2 : x, inkY(c, s, u * CAP_SIZE, cy, 700), {
    size: u * CAP_SIZE,
    weight: 700,
    fill,
    align,
    baseline: 'alphabetic',
    letterSpacing: track,
  });
}

/** ✓ and ✕ as paths, so the two chips weigh exactly the same. */
function tallyGlyph(
  c: CanvasRenderingContext2D,
  kind: 'tick' | 'cross',
  x: number,
  y: number,
  r: number,
  col: string,
  w: number,
): void {
  c.save();
  c.strokeStyle = col;
  c.lineWidth = w;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  if (kind === 'tick') {
    c.moveTo(x - r, y + r * 0.08);
    c.lineTo(x - r * 0.28, y + r * 0.74);
    c.lineTo(x + r, y - r * 0.74);
  } else {
    c.moveTo(x - r * 0.78, y - r * 0.78);
    c.lineTo(x + r * 0.78, y + r * 0.78);
    c.moveTo(x + r * 0.78, y - r * 0.78);
    c.lineTo(x - r * 0.78, y + r * 0.78);
  }
  c.stroke();
  c.restore();
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.46;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
  fillStroke(c, fill, PAL.ink, r * 0.22);
}

function drawTicket(
  c: CanvasRenderingContext2D,
  order: Order,
  msLeft: number,
  x: number,
  y: number,
  w: number,
  h: number,
  u: number,
  time: number,
): void {
  const frac = clamp(order.totalMs > 0 ? msLeft / order.totalMs : 0, 0, 1);
  const urgent = frac < 0.25;
  const flash = urgent ? 0.5 + 0.5 * Math.sin(time * 9) : 0;

  c.save();
  c.translate(x + w / 2, y + h / 2);
  // deterministic jaunty angle per order, plus a shake when nearly expired
  c.rotate((((order.id * 37) % 7) - 3) * 0.006 + flash * 0.012);
  if (urgent) c.scale(1 + flash * 0.035, 1 + flash * 0.035);
  c.translate(-w / 2, -h / 2);

  rr(c, 0, u * 5, w, h, u * 10);
  c.fillStyle = 'rgba(20, 11, 6, 0.5)';
  c.fill();

  rr(c, 0, 0, w, h, u * 10);
  fillStroke(
    c,
    urgent ? `rgb(255, ${Math.round(246 - flash * 40)}, ${Math.round(227 - flash * 60)})` : '#fff6e3',
    urgent ? PAL.tomato : PAL.ink,
    Math.max(2, u * 4),
  );

  // perforated header strip
  rr(c, u * 7, u * 7, w - u * 14, u * 8, u * 4);
  c.fillStyle = 'rgba(107, 69, 38, 0.22)';
  c.fill();

  const n = Math.max(1, order.recipe.length);
  const iconR = Math.min(u * 21, (w - u * 18) / (n * 2.25));
  const step = (w - u * 16) / n;
  for (let i = 0; i < n; i++) {
    const ing = order.recipe[i];
    if (!ing) continue;
    drawTicketIcon(c, ing, u * 8 + step * (i + 0.5), h * 0.46, iconR);
  }

  // draining time bar
  const bx = u * 10;
  const bw = w - u * 20;
  const bh = u * 13;
  const by = h - bh - u * 10;
  rr(c, bx, by, bw, bh, bh / 2);
  fillStroke(c, 'rgba(59, 35, 20, 0.22)', null, 0);
  const fw = Math.max(0, frac) * (bw - bh * 0.2);
  if (fw > 0.5) {
    rr(c, bx + bh * 0.1, by + bh * 0.16, Math.max(fw, bh * 0.8), bh * 0.68, bh * 0.34);
    c.fillStyle = urgent
      ? `rgba(232, 80, 58, ${0.55 + flash * 0.45})`
      : frac < 0.5
        ? PAL.amber
        : PAL.green;
    c.fill();
  }
  c.restore();
}

export function drawHud(
  c: CanvasRenderingContext2D,
  L: HudLayout,
  snap: Snapshot,
  msLeft: number,
  age: number,
  time: number,
): void {
  const { W, u, hudH } = L;

  // band
  c.save();
  rr(c, -u * 30, -u * 60, W + u * 60, hudH + u * 60, u * 26);
  c.fillStyle = PAL.hudBg;
  c.fill();
  c.fillStyle = PAL.hudEdge;
  c.fillRect(0, hudH - u * 6, W, u * 6);
  c.restore();

  const midY = (hudH - u * 6) / 2;
  /** Every big figure in the bar — score and clock — is this size. */
  const figSize = u * 62;

  // --- score: caption, then star + figure on one axis, then the chips ---
  const sx = u * 44;
  const capCy = u * 23;
  const numCy = u * 72;
  const starR = u * 22;

  caption(c, 'SCORE', sx, capCy, u);

  // A five-point star's ink sits above its centre; nudge it back onto the axis.
  star(c, sx + starR, numCy + starR * 0.096, starR, PAL.butter);
  // The minus lives in a reserved gutter, so `-29` and `29` put their first
  // digit — and therefore the star — in exactly the same place.
  const minusW = widthOf(c, '-', figSize);
  const digits = String(Math.abs(snap.score));
  const numX = sx + starR * 2 + u * 17 + minusW;
  const numY = inkY(c, digits, figSize, numCy);
  const figure = {
    size: figSize,
    fill: PAL.cream,
    outline: PAL.ink,
    outlineWidth: figSize * OUTLINE,
    align: 'left' as const,
    baseline: 'alphabetic' as const,
  };
  if (snap.score < 0) text(c, '-', numX - minusW, numY, figure);
  text(c, digits, numX, numY, figure);

  // served / missed chips, on the same left edge, one clear band below
  const chipH = u * 36;
  const chipCy = u * 123;
  const glyphR = u * 8;
  const chipPad = u * 15;
  const chipGap = u * 11;
  const chipSize = u * 28;
  const chips: Array<['tick' | 'cross', string, number]> = [
    ['tick', '#4fd18b', snap.served],
    ['cross', PAL.tomato, snap.missed],
  ];
  let cx = sx;
  for (const [kind, col, val] of chips) {
    const label = String(val);
    const w = chipPad * 2 + glyphR * 2 + chipGap + widthOf(c, label, chipSize);
    rr(c, cx, chipCy - chipH / 2, w, chipH, chipH / 2);
    fillStroke(c, 'rgba(255,246,227,0.12)', 'rgba(255,246,227,0.22)', Math.max(1.5, u * 2.5));
    tallyGlyph(c, kind, cx + chipPad + glyphR, chipCy, glyphR, col, Math.max(2, u * 5));
    text(c, label, cx + chipPad + glyphR * 2 + chipGap, inkY(c, label, chipSize, chipCy), {
      size: chipSize,
      weight: 800,
      fill: 'rgba(255,246,227,0.92)',
      align: 'left',
      baseline: 'alphabetic',
    });
    cx += w + u * 12;
  }

  // --- clock: same rule — caption above the figure, both inside the pill ---
  const low = msLeft <= 30_000;
  const pulse = low ? 0.5 + 0.5 * Math.sin(time * 7) : 0;
  // Measured off a reference so the pill cannot breathe between 1:59 and 0:09.
  const tw = Math.max(u * 230, widthOf(c, '0:00', figSize) + u * 76);
  const th = u * 118;
  c.save();
  c.translate(W / 2, midY);
  c.scale(1 + pulse * 0.05, 1 + pulse * 0.05);
  rr(c, -tw / 2, -th / 2, tw, th, u * 30);
  fillStroke(
    c,
    low ? `rgba(120, 22, 14, ${0.75 + pulse * 0.25})` : 'rgba(255,246,227,0.10)',
    low ? PAL.tomato : 'rgba(255,246,227,0.24)',
    u * 4,
  );
  caption(c, 'TIME', 0, -u * 33.5, u, low ? 'rgba(255,220,212,0.82)' : CAP_FILL, 'center');
  const face = clock(msLeft);
  text(c, face, 0, inkY(c, face, figSize, u * 15.5), {
    size: figSize,
    fill: low ? '#ffdcd4' : PAL.cream,
    outline: PAL.ink,
    outlineWidth: figSize * OUTLINE,
    baseline: 'alphabetic',
  });
  c.restore();

  // --- order tickets ---
  const tkW = u * 150;
  const tkH = u * 118;
  const gap = u * 14;
  const right = W - u * 36;
  const top = (hudH - u * 6 - tkH) / 2;
  const n = snap.orders.length;
  for (let i = 0; i < n; i++) {
    const o = snap.orders[i];
    if (!o) continue;
    const x = right - (n - i) * (tkW + gap) + gap;
    drawTicket(c, o, Math.max(0, o.msLeft - age), x, top, tkW, tkH, u, time);
  }
  if (n === 0) {
    text(c, 'NO ORDERS', right - u * 90, midY, {
      size: u * 26,
      weight: 700,
      fill: 'rgba(255,246,227,0.4)',
      letterSpacing: u * 4,
    });
  }
}
