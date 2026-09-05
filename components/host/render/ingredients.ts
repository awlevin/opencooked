// Ingredient glyphs, plates and soup. Every icon is drawn the same way
// wherever it appears — crate face, board, pot, plate, order ticket — so the
// player can read a ticket and scan the kitchen for the same shape.

import {
  BURN_MS,
  COOK_MS,
  POT_CAPACITY,
  type HeldItem,
  type IngredientType,
  type Pot,
} from '@/shared/types';
import {
  INGREDIENT_COLORS,
  PAL,
  circle,
  clamp,
  ellipse,
  fillStroke,
  mix,
  rr,
  shade,
  tint,
} from './theme';

/** Width the pot artwork was authored at, in tile units. */
const POT_SIZE = 0.66;
/** Width the extinguisher artwork was authored at, in tile units. */
const EXT_SIZE = 0.42;
/** Outline width for the cookware, in the pot's own authored units. */
const POT_OUT = 0.055;

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

/** The bare ring of a stove: what is left when the pot is carried away. */
export function drawBurner(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  time: number,
): void {
  const k = size / POT_SIZE;
  c.save();
  c.translate(x, y);
  c.scale(k, k);
  ellipse(c, 0, 0.02, 0.4, 0.14);
  fillStroke(c, PAL.metalDark, PAL.ink, POT_OUT * 0.8);
  // gas ring, breathing a little so an empty stove still feels alive
  c.globalAlpha = 0.5 + 0.16 * Math.sin(time * 2.4);
  circle(c, 0, 0.02, 0.24);
  fillStroke(c, 'rgba(255,150,60,0.5)', 'rgba(255,196,110,0.8)', POT_OUT * 0.6);
  c.globalAlpha = 1;
  c.restore();
}

/**
 * A cooking pot, wherever it is: on a ring, on a counter, or in two hands.
 * `size` is the width of the body in the caller's units; everything else is
 * proportional to it, so one routine serves every context.
 *
 * `onHeat` says whether this pot's timers are actually running. Off the ring
 * they are frozen, and a countdown ring that never moves would be a lie — so
 * the pot keeps its steam and its contents, but loses the dial.
 */
export function drawPot(
  c: CanvasRenderingContext2D,
  pot: Pot,
  x: number,
  y: number,
  size: number,
  time: number,
  onHeat = true,
): void {
  const k = size / POT_SIZE;
  const burnt = pot.state === 'burnt';
  const done = pot.state === 'done';
  const OUT = POT_OUT;

  c.save();
  c.translate(x, y);
  c.scale(k, k);

  if (done) {
    const g = c.createRadialGradient(0, 0, 0.05, 0, 0, 0.66);
    g.addColorStop(0, 'rgba(80, 235, 150, 0.6)');
    g.addColorStop(1, 'rgba(80, 235, 150, 0)');
    c.fillStyle = g;
    c.fillRect(-0.7, -0.7, 1.4, 1.4);
  }

  // handles first, so the body overlaps their inner ends
  for (const s of [-1, 1]) {
    rr(c, s * 0.3 - (s > 0 ? 0 : 0.13), -0.04, 0.13, 0.13, 0.06);
    fillStroke(c, PAL.metalDark, PAL.ink, OUT * 0.8);
  }
  // body
  const bg = c.createLinearGradient(0, -0.22, 0, 0.3);
  bg.addColorStop(0, burnt ? shade(PAL.potHi, 0.45) : PAL.potHi);
  bg.addColorStop(1, burnt ? shade(PAL.pot, 0.5) : PAL.pot);
  rr(c, -0.33, -0.19, 0.66, 0.47, 0.13);
  fillStroke(c, bg, PAL.ink, OUT);
  // rim
  ellipse(c, 0, -0.19, 0.34, 0.115);
  fillStroke(c, PAL.potRim, PAL.ink, OUT);

  // contents
  if (pot.contents.length > 0) {
    const col = burnt ? '#241d18' : soupColor(pot.contents);
    ellipse(c, 0, -0.19, 0.275, 0.088);
    fillStroke(c, col, shade(col, 0.4), OUT * 0.6);
    if (!burnt) {
      for (let i = 0; i < pot.contents.length; i++) {
        const a = (i / pot.contents.length) * Math.PI * 2 + time * 0.6;
        circle(c, Math.cos(a) * 0.125, -0.19 + Math.sin(a) * 0.036, 0.04);
        c.fillStyle = tint(INGREDIENT_COLORS[pot.contents[i]!], 0.15);
        c.fill();
      }
    }
    if (pot.state === 'cooking') {
      // bubbling
      for (let i = 0; i < 4; i++) {
        const t = (time * 0.9 + i * 0.27) % 1;
        const a = i * 1.9;
        c.globalAlpha = 0.75 * (1 - t);
        circle(c, Math.cos(a) * 0.15, -0.19 + Math.sin(a) * 0.045 - t * 0.07, 0.02 + t * 0.034);
        c.fillStyle = tint(col, 0.5);
        c.fill();
      }
      c.globalAlpha = 1;
    }
  }

  // fill pips: how many of POT_CAPACITY slots are used
  for (let i = 0; i < POT_CAPACITY; i++) {
    const px = (i - (POT_CAPACITY - 1) / 2) * 0.15;
    circle(c, px, 0.43, 0.048);
    const ing = pot.contents[i];
    fillStroke(c, ing ? INGREDIENT_COLORS[ing] : 'rgba(24,14,8,0.55)', PAL.ink, OUT * 0.65);
  }

  // state feedback
  if (pot.state === 'cooking') {
    if (onHeat) {
      const frac = clamp(pot.cookMs / COOK_MS, 0, 1);
      c.beginPath();
      c.arc(0, 0, 0.45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      c.strokeStyle = PAL.amber;
      c.lineWidth = 0.075;
      c.lineCap = 'round';
      c.stroke();
    }
    drawSteam(c, 0, -0.3, 0.15, time * 0.8, 'rgba(255,255,255,0.5)');
  } else if (done) {
    // the pot keeps a timer running toward burnt; accept either convention
    // (reset-to-zero or continuing past COOK_MS).
    if (onHeat) {
      const since = pot.cookMs >= COOK_MS ? pot.cookMs - COOK_MS : pot.cookMs;
      const left = clamp(1 - since / BURN_MS, 0, 1);
      c.beginPath();
      c.arc(0, 0, 0.45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      c.strokeStyle = left > 0.35 ? '#4ce08c' : PAL.tomato;
      c.lineWidth = 0.075;
      c.lineCap = 'round';
      c.stroke();
    }
    drawSteam(c, 0, -0.32, 0.18, time, 'rgba(190,255,215,0.85)');
  } else if (burnt) {
    for (let i = 0; i < 4; i++) {
      const t = (time * 0.42 + i * 0.25) % 1;
      c.globalAlpha = 0.62 * (1 - t);
      circle(c, Math.sin((t + i) * 4.1) * 0.14, -0.26 - t * 0.55, 0.06 + t * 0.14);
      c.fillStyle = '#1b1512';
      c.fill();
    }
    c.globalAlpha = 1;
  }

  c.restore();
}

/**
 * The fire extinguisher: red bottle, black cap, hose looped round to a horn.
 * `size` is the width of the bottle, everything else follows from it.
 */
export function drawExtinguisher(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  time: number,
): void {
  const k = size / EXT_SIZE;
  const OUT = 0.05;
  c.save();
  c.translate(x, y);
  c.scale(k, k);

  // hose, behind the bottle: up out of the valve, round and back down
  c.beginPath();
  c.moveTo(0.12, -0.3);
  c.bezierCurveTo(0.46, -0.34, 0.5, 0.02, 0.3, 0.16);
  c.strokeStyle = PAL.ink;
  c.lineWidth = 0.13;
  c.lineCap = 'round';
  c.stroke();
  c.strokeStyle = '#4a4a52';
  c.lineWidth = 0.075;
  c.stroke();
  // horn
  c.beginPath();
  c.moveTo(0.24, 0.09);
  c.lineTo(0.42, 0.13);
  c.lineTo(0.42, 0.3);
  c.lineTo(0.24, 0.23);
  c.closePath();
  fillStroke(c, '#2f2f36', PAL.ink, OUT);

  // bottle
  const g = c.createLinearGradient(-0.21, 0, 0.21, 0);
  g.addColorStop(0, '#a32a20');
  g.addColorStop(0.42, '#e0402c');
  g.addColorStop(1, '#8f231b');
  rr(c, -0.21, -0.26, 0.42, 0.68, 0.13);
  fillStroke(c, g, PAL.ink, OUT * 1.1);
  // label band
  rr(c, -0.19, -0.04, 0.38, 0.19, 0.05);
  fillStroke(c, PAL.cream, null, 0);
  c.beginPath();
  c.moveTo(-0.04, 0.13);
  c.lineTo(0.02, 0.02);
  c.lineTo(-0.01, 0.02);
  c.lineTo(0.05, -0.03);
  c.strokeStyle = PAL.tomato;
  c.lineWidth = 0.045;
  c.lineJoin = 'round';
  c.stroke();
  // shoulder + cap + trigger handle
  rr(c, -0.15, -0.36, 0.3, 0.13, 0.05);
  fillStroke(c, '#2f2f36', PAL.ink, OUT);
  rr(c, -0.05, -0.46, 0.2, 0.08, 0.04);
  fillStroke(c, '#2f2f36', PAL.ink, OUT);
  // pressure gauge, needle twitching in the green
  circle(c, -0.13, -0.44, 0.075);
  fillStroke(c, '#f6f2e4', PAL.ink, OUT * 0.9);
  c.beginPath();
  c.moveTo(-0.13, -0.44);
  const a = -Math.PI / 2 + Math.sin(time * 2.1) * 0.35;
  c.lineTo(-0.13 + Math.cos(a) * 0.05, -0.44 + Math.sin(a) * 0.05);
  c.strokeStyle = PAL.green;
  c.lineWidth = 0.03;
  c.stroke();
  c.restore();
}

/** Anything a chef or a counter can be holding. */
export function drawHeldItem(
  c: CanvasRenderingContext2D,
  item: HeldItem,
  x: number,
  y: number,
  r: number,
  time = 0,
): void {
  switch (item.kind) {
    case 'plate':
      drawPlate(c, x, y, r, item.soup);
      return;
    case 'ingredient':
      drawIngredient(c, item.ing, x, y, r * 0.86);
      return;
    case 'pot':
      // Both hands: a pot is heavier and wider than a plate, and it hangs a
      // little lower. Off the ring, so no cooking dial.
      drawPot(c, item.pot, x, y + r * 0.16, r * 2.6, time, false);
      return;
    case 'extinguisher':
      drawExtinguisher(c, x, y, r * 1.35, time);
      return;
  }
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
