// Ingredient glyphs, plates and soup. Every icon is drawn the same way
// wherever it appears — crate face, board, pot, plate, order ticket — so the
// player can read a ticket and scan the kitchen for the same shape.

import type { HeldItem, IngredientType } from '@/shared/types';
import {
  INGREDIENT_COLORS,
  PAL,
  circle,
  ellipse,
  fillStroke,
  mix,
  rr,
  shade,
  tint,
} from './theme';

/** Whole (unchopped) ingredient, centred at (x,y) with radius r. */
function drawWhole(
  c: CanvasRenderingContext2D,
  type: IngredientType,
  x: number,
  y: number,
  r: number,
): void {
  const lw = r * 0.17;
  const ink = PAL.ink;

  if (type === 'onion') {
    const body = INGREDIENT_COLORS.onion;
    // sprout
    c.beginPath();
    c.moveTo(x, y - r * 0.55);
    c.quadraticCurveTo(x - r * 0.15, y - r * 1.25, x - r * 0.55, y - r * 1.35);
    c.moveTo(x, y - r * 0.55);
    c.quadraticCurveTo(x + r * 0.2, y - r * 1.3, x + r * 0.5, y - r * 1.3);
    c.strokeStyle = '#4fae54';
    c.lineWidth = lw * 1.3;
    c.lineCap = 'round';
    c.stroke();

    ellipse(c, x, y + r * 0.06, r * 0.92, r * 0.94);
    fillStroke(c, body, ink, lw);
    // papery skin lines
    c.save();
    c.beginPath();
    ellipse(c, x, y + r * 0.06, r * 0.92, r * 0.94);
    c.clip();
    c.strokeStyle = shade(body, 0.22);
    c.lineWidth = lw * 0.7;
    for (const o of [-0.42, 0, 0.42]) {
      c.beginPath();
      c.moveTo(x + r * o, y - r * 0.95);
      c.quadraticCurveTo(x + r * o * 2.1, y + r * 0.1, x + r * o, y + r * 1.05);
      c.stroke();
    }
    c.restore();
    return;
  }

  if (type === 'tomato') {
    const body = INGREDIENT_COLORS.tomato;
    ellipse(c, x, y + r * 0.08, r * 0.95, r * 0.88);
    fillStroke(c, body, ink, lw);
    // gloss
    c.save();
    c.globalAlpha = 0.55;
    ellipse(c, x - r * 0.34, y - r * 0.28, r * 0.24, r * 0.16);
    c.fillStyle = '#fff';
    c.fill();
    c.restore();
    // calyx
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      c.moveTo(x, y - r * 0.62);
      c.lineTo(x + Math.cos(a) * r * 0.5, y - r * 0.62 + Math.sin(a) * r * 0.34);
    }
    c.strokeStyle = '#3f9b4b';
    c.lineWidth = lw * 1.5;
    c.lineCap = 'round';
    c.stroke();
    c.beginPath();
    c.moveTo(x, y - r * 0.62);
    c.lineTo(x, y - r * 1.05);
    c.strokeStyle = '#3f9b4b';
    c.lineWidth = lw * 1.3;
    c.stroke();
    return;
  }

  // mushroom
  const cap = INGREDIENT_COLORS.mushroom;
  // stem
  c.beginPath();
  c.moveTo(x - r * 0.34, y - r * 0.05);
  c.lineTo(x - r * 0.28, y + r * 0.72);
  c.quadraticCurveTo(x, y + r * 1.0, x + r * 0.28, y + r * 0.72);
  c.lineTo(x + r * 0.34, y - r * 0.05);
  c.closePath();
  fillStroke(c, '#f6e9d2', ink, lw);
  // cap
  c.beginPath();
  c.moveTo(x - r * 0.95, y - r * 0.02);
  c.quadraticCurveTo(x - r * 0.9, y - r * 1.05, x, y - r * 1.02);
  c.quadraticCurveTo(x + r * 0.9, y - r * 1.05, x + r * 0.95, y - r * 0.02);
  c.quadraticCurveTo(x, y + r * 0.26, x - r * 0.95, y - r * 0.02);
  c.closePath();
  fillStroke(c, cap, ink, lw);
  c.fillStyle = tint(cap, 0.5);
  for (const [dx, dy, rr2] of [
    [-0.42, -0.5, 0.16],
    [0.12, -0.68, 0.13],
    [0.5, -0.38, 0.12],
  ] as const) {
    circle(c, x + r * dx, y + r * dy, r * rr2);
    c.fill();
  }
}

/** Chopped ingredient: three slices in a little fan. */
function drawChopped(
  c: CanvasRenderingContext2D,
  type: IngredientType,
  x: number,
  y: number,
  r: number,
): void {
  const body = INGREDIENT_COLORS[type];
  const lw = r * 0.15;
  const slices = [
    { dx: -0.52, dy: 0.24, rot: -0.34 },
    { dx: 0.0, dy: -0.12, rot: 0.08 },
    { dx: 0.52, dy: 0.28, rot: 0.36 },
  ];
  for (const s of slices) {
    c.save();
    c.translate(x + r * s.dx, y + r * s.dy);
    c.rotate(s.rot);
    ellipse(c, 0, 0, r * 0.48, r * 0.4);
    fillStroke(c, body, PAL.ink, lw);
    ellipse(c, 0, 0, r * 0.26, r * 0.2);
    fillStroke(c, tint(body, type === 'tomato' ? 0.35 : 0.28), null, 0);
    c.restore();
  }
}

export function drawIngredient(
  c: CanvasRenderingContext2D,
  ing: { type: IngredientType; chopped: boolean },
  x: number,
  y: number,
  r: number,
): void {
  if (ing.chopped) drawChopped(c, ing.type, x, y, r);
  else drawWhole(c, ing.type, x, y, r);
}

/** Blended soup surface colour for a set of ingredients. */
export function soupColor(contents: IngredientType[]): string {
  if (contents.length === 0) return '#e8c88a';
  let acc: string = INGREDIENT_COLORS[contents[0]!];
  for (let i = 1; i < contents.length; i++) {
    acc = mix(acc, INGREDIENT_COLORS[contents[i]!], 1 / (i + 1));
  }
  return mix(acc, '#c8843c', 0.32);
}

/** Plate seen from slightly above. `soup === null` means empty. */
export function drawPlate(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  soup: IngredientType[] | null,
): void {
  const lw = r * 0.14;
  ellipse(c, x, y, r, r * 0.8);
  fillStroke(c, PAL.plate, PAL.ink, lw);
  ellipse(c, x, y, r * 0.72, r * 0.55);
  fillStroke(c, soup ? shade(PAL.plateShade, 0.05) : PAL.plateShade, null, 0);

  if (soup && soup.length > 0) {
    const col = soupColor(soup);
    ellipse(c, x, y, r * 0.66, r * 0.5);
    fillStroke(c, col, shade(col, 0.35), lw * 0.7);
    // chunks
    for (let i = 0; i < soup.length; i++) {
      const a = (i / soup.length) * Math.PI * 2 + 0.6;
      circle(
        c,
        x + Math.cos(a) * r * 0.3,
        y + Math.sin(a) * r * 0.2,
        r * 0.13,
      );
      c.fillStyle = tint(INGREDIENT_COLORS[soup[i]!], 0.12);
      c.fill();
    }
    c.save();
    c.globalAlpha = 0.5;
    ellipse(c, x - r * 0.28, y - r * 0.18, r * 0.16, r * 0.07);
    c.fillStyle = '#fff';
    c.fill();
    c.restore();
  } else {
    c.save();
    c.globalAlpha = 0.7;
    ellipse(c, x - r * 0.35, y - r * 0.28, r * 0.2, r * 0.09);
    c.fillStyle = '#fff';
    c.fill();
    c.restore();
  }
}

/** Anything a chef or a counter can be holding. */
export function drawHeldItem(
  c: CanvasRenderingContext2D,
  item: HeldItem,
  x: number,
  y: number,
  r: number,
): void {
  if (item.kind === 'plate') drawPlate(c, x, y, r, item.soup);
  else drawIngredient(c, item.ing, x, y, r * 0.86);
}

/** Rising wisps. `phase` is a free-running time in seconds. */
export function drawSteam(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  phase: number,
  color = 'rgba(255,255,255,0.75)',
): void {
  c.save();
  for (let i = 0; i < 3; i++) {
    const t = (phase * 0.55 + i / 3) % 1;
    const yy = y - t * r * 2.4;
    const xx = x + Math.sin((t + i) * 5.2) * r * 0.45 + (i - 1) * r * 0.3;
    const rad = r * (0.2 + t * 0.42);
    c.globalAlpha = Math.max(0, 0.6 * (1 - t));
    circle(c, xx, yy, rad);
    c.fillStyle = color;
    c.fill();
  }
  c.restore();
}

/** Little ingredient tile used on order tickets (screen-space pixels). */
export function drawTicketIcon(
  c: CanvasRenderingContext2D,
  type: IngredientType,
  x: number,
  y: number,
  r: number,
): void {
  c.save();
  circle(c, x, y, r * 1.16);
  fillStroke(c, tint(INGREDIENT_COLORS[type], 0.72), PAL.ink, r * 0.13);
  drawWhole(c, type, x, y, r * 0.82);
  c.restore();
}

/** Small rounded-rect chip helper reused by tickets. */
export function chip(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fill: string,
): void {
  rr(c, x, y, w, h, radius);
  fillStroke(c, fill, null, 0);
}
