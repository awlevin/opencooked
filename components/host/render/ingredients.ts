// Ingredient art, plates and cookware. Every icon is drawn the same way
// wherever it appears — crate face, board, pot, plate, order ticket — so the
// player can read a ticket and then scan the kitchen for the same shape.
//
// The food is a registry keyed by IngredientType: one routine per ingredient,
// every one with the same `(ctx, model, x, y, size, time)` shape and no hidden
// globals, so a sprite sheet can replace them one at a time later.

import { INGREDIENTS, type IngredientType } from '@/shared/catalogue';
import {
  BURN_MS,
  COOK_MS,
  FRY_MS,
  PAN_CAPACITY,
  POT_CAPACITY,
  type HeldItem,
  type Ingredient,
  type Pot,
} from '@/shared/types';
import {
  INGREDIENT_ACCENTS,
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
/**
 * Width the pan artwork was authored at, in tile units. Tiles are painted in
 * reading order, so anything a pan draws outside its own tile is covered by
 * the next one — which is why the handle is short and the body sits left.
 */
const PAN_SIZE = 0.66;
/** Width the extinguisher artwork was authored at, in tile units. */
const EXT_SIZE = 0.42;
/** Outline width for the cookware, in the pot's own authored units. */
const POT_OUT = 0.055;

/** Everything the art needs to know about one piece of food. */
export interface IngredientView {
  type: IngredientType;
  chopped: boolean;
  cooked: boolean;
}

/**
 * One ingredient, centred on (x, y) at radius `r`. Each routine owns all three
 * of its looks — raw, prepared, cooked — because they have to read as the same
 * food at a glance.
 */
type IngredientArt = (
  c: CanvasRenderingContext2D,
  ing: IngredientView,
  x: number,
  y: number,
  r: number,
  time: number,
) => void;

/* ---------------------------- shared helpers ---------------------------- */

/** Chopped soup vegetable: three slices in a little fan. */
function slices(
  c: CanvasRenderingContext2D,
  type: IngredientType,
  x: number,
  y: number,
  r: number,
): void {
  const body = INGREDIENT_COLORS[type];
  const lw = r * 0.15;
  for (const s of [
    { dx: -0.52, dy: 0.24, rot: -0.34 },
    { dx: 0.0, dy: -0.12, rot: 0.08 },
    { dx: 0.52, dy: 0.28, rot: 0.36 },
  ]) {
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

/* ----------------------------- the registry ----------------------------- */

const drawOnion: IngredientArt = (c, ing, x, y, r) => {
  if (ing.chopped) return slices(c, 'onion', x, y, r);
  const body = INGREDIENT_COLORS.onion;
  const lw = r * 0.17;
  // sprout
  c.beginPath();
  c.moveTo(x, y - r * 0.55);
  c.quadraticCurveTo(x - r * 0.15, y - r * 1.25, x - r * 0.55, y - r * 1.35);
  c.moveTo(x, y - r * 0.55);
  c.quadraticCurveTo(x + r * 0.2, y - r * 1.3, x + r * 0.5, y - r * 1.3);
  c.strokeStyle = INGREDIENT_ACCENTS.onion;
  c.lineWidth = lw * 1.3;
  c.lineCap = 'round';
  c.stroke();

  ellipse(c, x, y + r * 0.06, r * 0.92, r * 0.94);
  fillStroke(c, body, PAL.ink, lw);
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
};

const drawTomato: IngredientArt = (c, ing, x, y, r) => {
  if (ing.chopped) return slices(c, 'tomato', x, y, r);
  const body = INGREDIENT_COLORS.tomato;
  const lw = r * 0.17;
  ellipse(c, x, y + r * 0.08, r * 0.95, r * 0.88);
  fillStroke(c, body, PAL.ink, lw);
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
  c.strokeStyle = INGREDIENT_ACCENTS.tomato;
  c.lineWidth = lw * 1.5;
  c.lineCap = 'round';
  c.stroke();
  c.beginPath();
  c.moveTo(x, y - r * 0.62);
  c.lineTo(x, y - r * 1.05);
  c.strokeStyle = INGREDIENT_ACCENTS.tomato;
  c.lineWidth = lw * 1.3;
  c.stroke();
};

const drawMushroom: IngredientArt = (c, ing, x, y, r) => {
  if (ing.chopped) return slices(c, 'mushroom', x, y, r);
  const cap = INGREDIENT_COLORS.mushroom;
  const lw = r * 0.17;
  c.beginPath();
  c.moveTo(x - r * 0.34, y - r * 0.05);
  c.lineTo(x - r * 0.28, y + r * 0.72);
  c.quadraticCurveTo(x, y + r * 1.0, x + r * 0.28, y + r * 0.72);
  c.lineTo(x + r * 0.34, y - r * 0.05);
  c.closePath();
  fillStroke(c, INGREDIENT_ACCENTS.mushroom, PAL.ink, lw);
  c.beginPath();
  c.moveTo(x - r * 0.95, y - r * 0.02);
  c.quadraticCurveTo(x - r * 0.9, y - r * 1.05, x, y - r * 1.02);
  c.quadraticCurveTo(x + r * 0.9, y - r * 1.05, x + r * 0.95, y - r * 0.02);
  c.quadraticCurveTo(x, y + r * 0.26, x - r * 0.95, y - r * 0.02);
  c.closePath();
  fillStroke(c, cap, PAL.ink, lw);
  c.fillStyle = tint(cap, 0.5);
  for (const [dx, dy, rad] of [
    [-0.42, -0.5, 0.16],
    [0.12, -0.68, 0.13],
    [0.5, -0.38, 0.12],
  ] as const) {
    circle(c, x + r * dx, y + r * dy, r * rad);
    c.fill();
  }
};

/** A ruffled head of lettuce; wide shreds once it has met the knife. */
const drawLettuce: IngredientArt = (c, ing, x, y, r) => {
  const body = INGREDIENT_COLORS.lettuce;
  const dark = INGREDIENT_ACCENTS.lettuce;
  const lw = r * 0.16;
  if (ing.chopped) {
    // Curled leaf strips with real width. At tile size a thin stroke reads as
    // a worm; a shred of lettuce has to read as a piece of leaf.
    for (const [dx, dy, rot, tone] of [
      [-0.34, 0.3, -0.2, 0.1],
      [0.08, -0.3, 0.15, 0.34],
      [0.36, 0.26, 0.28, 0.2],
    ] as const) {
      c.save();
      c.translate(x + r * dx, y + r * dy);
      c.rotate(rot);
      c.beginPath();
      c.moveTo(-r * 0.52, 0);
      c.quadraticCurveTo(0, -r * 0.56, r * 0.52, 0);
      c.quadraticCurveTo(0, r * 0.12, -r * 0.52, 0);
      c.closePath();
      fillStroke(c, tint(body, tone), PAL.ink, lw * 0.75);
      c.restore();
    }
    return;
  }
  // Outer leaves as a scalloped edge, so the head never reads as a melon.
  const lobes = 9;
  c.beginPath();
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 - Math.PI / 2;
    const mid = a + Math.PI / lobes;
    const px = x + Math.cos(a) * r * 0.86;
    const py = y + Math.sin(a) * r * 0.86;
    if (i === 0) c.moveTo(px, py);
    else {
      c.quadraticCurveTo(
        x + Math.cos(mid - Math.PI / lobes) * r * 1.06,
        y + Math.sin(mid - Math.PI / lobes) * r * 1.06,
        px,
        py,
      );
    }
  }
  c.closePath();
  fillStroke(c, dark, PAL.ink, lw);
  // the pale heart, curled in on itself
  circle(c, x - r * 0.06, y + r * 0.04, r * 0.62);
  fillStroke(c, tint(body, 0.18), null, 0);
  circle(c, x + r * 0.1, y - r * 0.06, r * 0.34);
  fillStroke(c, tint(body, 0.42), null, 0);
  c.strokeStyle = shade(body, 0.24);
  c.lineWidth = lw * 0.5;
  c.lineCap = 'round';
  for (const [ax, ay, bx, by] of [
    [-0.5, 0.2, -0.05, -0.3],
    [0.5, 0.28, 0.1, -0.1],
    [-0.1, 0.68, 0.05, 0.2],
  ] as const) {
    c.beginPath();
    c.moveTo(x + r * ax, y + r * ay);
    c.quadraticCurveTo(x + r * (ax + bx) * 0.5, y + r * (ay + by) * 0.5, x + r * bx, y + r * by);
    c.stroke();
  }
};

/** A wedge with holes; three flat slices once cut. */
const drawCheese: IngredientArt = (c, ing, x, y, r) => {
  const body = INGREDIENT_COLORS.cheese;
  const rind = INGREDIENT_ACCENTS.cheese;
  const lw = r * 0.16;
  if (ing.chopped) {
    // Three flat slices, each a rhombus seen from above and given a thin dark
    // edge so it reads as a slab rather than a stripe.
    for (const [dx, dy] of [
      [-0.2, 0.34],
      [0.0, 0.0],
      [0.2, -0.34],
    ] as const) {
      const px = x + r * dx;
      const py = y + r * dy;
      const slab = (oy: number): void => {
        c.beginPath();
        c.moveTo(px - r * 0.54, py + r * (0.04 + oy));
        c.lineTo(px - r * 0.12, py - r * (0.3 - oy));
        c.lineTo(px + r * 0.54, py - r * (0.04 - oy));
        c.lineTo(px + r * 0.12, py + r * (0.3 + oy));
        c.closePath();
      };
      slab(0.1);
      fillStroke(c, shade(body, 0.28), PAL.ink, lw * 0.8);
      slab(0);
      fillStroke(c, body, PAL.ink, lw * 0.8);
    }
    return;
  }
  // wedge: a triangle seen at a slight angle, with a thick front face
  c.beginPath();
  c.moveTo(x - r * 0.86, y + r * 0.42);
  c.lineTo(x + r * 0.86, y + r * 0.42);
  c.lineTo(x + r * 0.86, y + r * 0.72);
  c.lineTo(x - r * 0.86, y + r * 0.72);
  c.closePath();
  fillStroke(c, rind, PAL.ink, lw);
  c.beginPath();
  c.moveTo(x - r * 0.86, y + r * 0.42);
  c.lineTo(x + r * 0.52, y - r * 0.78);
  c.lineTo(x + r * 0.86, y + r * 0.42);
  c.closePath();
  fillStroke(c, body, PAL.ink, lw);
  c.fillStyle = shade(body, 0.16);
  for (const [dx, dy, rad] of [
    [-0.24, 0.2, 0.15],
    [0.28, 0.16, 0.11],
    [0.1, -0.16, 0.09],
  ] as const) {
    circle(c, x + r * dx, y + r * dy, r * rad);
    c.fill();
  }
};

/** A sesame bun, drawn as the pair of halves it becomes on a burger. */
const drawBun: IngredientArt = (c, _ing, x, y, r) => {
  const body = INGREDIENT_COLORS.bun;
  const seed = INGREDIENT_ACCENTS.bun;
  const lw = r * 0.16;
  // heel
  rr(c, x - r * 0.82, y + r * 0.3, r * 1.64, r * 0.44, r * 0.2);
  fillStroke(c, shade(body, 0.12), PAL.ink, lw);
  // crown
  c.beginPath();
  c.moveTo(x - r * 0.86, y + r * 0.22);
  c.quadraticCurveTo(x - r * 0.8, y - r * 0.86, x, y - r * 0.86);
  c.quadraticCurveTo(x + r * 0.8, y - r * 0.86, x + r * 0.86, y + r * 0.22);
  c.closePath();
  fillStroke(c, body, PAL.ink, lw);
  c.fillStyle = seed;
  for (const [dx, dy, a] of [
    [-0.42, -0.3, 0.4],
    [-0.04, -0.5, -0.2],
    [0.4, -0.26, 0.5],
    [0.16, -0.12, 0.1],
    [-0.24, -0.02, -0.4],
  ] as const) {
    c.save();
    c.translate(x + r * dx, y + r * dy);
    c.rotate(a);
    ellipse(c, 0, 0, r * 0.12, r * 0.06);
    c.fill();
    c.restore();
  }
};

/** Raw slab, raw patty, then a browned patty with grill marks. */
const drawMeat: IngredientArt = (c, ing, x, y, r) => {
  const raw = INGREDIENT_COLORS.meat;
  const cooked = INGREDIENT_ACCENTS.meat;
  const lw = r * 0.16;
  if (ing.cooked) {
    ellipse(c, x, y + r * 0.16, r * 0.92, r * 0.36);
    fillStroke(c, shade(cooked, 0.3), PAL.ink, lw);
    ellipse(c, x, y - r * 0.04, r * 0.92, r * 0.5);
    fillStroke(c, cooked, PAL.ink, lw);
    // grill marks
    c.save();
    c.beginPath();
    ellipse(c, x, y - r * 0.04, r * 0.92, r * 0.5);
    c.clip();
    c.strokeStyle = shade(cooked, 0.45);
    c.lineWidth = r * 0.16;
    c.lineCap = 'round';
    for (const o of [-0.5, 0.05, 0.6]) {
      c.beginPath();
      c.moveTo(x + r * (o - 0.4), y - r * 0.5);
      c.lineTo(x + r * (o + 0.2), y + r * 0.45);
      c.stroke();
    }
    c.restore();
    return;
  }
  if (ing.chopped) {
    // a formed raw patty: same disc, uncooked colour, a little marbling
    ellipse(c, x, y + r * 0.14, r * 0.9, r * 0.34);
    fillStroke(c, shade(raw, 0.25), PAL.ink, lw);
    ellipse(c, x, y - r * 0.04, r * 0.9, r * 0.48);
    fillStroke(c, raw, PAL.ink, lw);
    c.strokeStyle = tint(raw, 0.42);
    c.lineWidth = r * 0.09;
    c.lineCap = 'round';
    for (const [dx, dy] of [
      [-0.4, -0.14],
      [0.12, 0.1],
      [0.42, -0.2],
    ] as const) {
      c.beginPath();
      c.moveTo(x + r * dx, y + r * dy);
      c.quadraticCurveTo(x + r * (dx + 0.16), y + r * (dy - 0.14), x + r * (dx + 0.3), y + r * dy);
      c.stroke();
    }
    return;
  }
  // Raw slab out of the crate: a steak silhouette with a fat rim down one
  // side, so it never reads as a slice of ham.
  const steak = (): void => {
    c.beginPath();
    c.moveTo(x - r * 0.86, y - r * 0.22);
    c.quadraticCurveTo(x - r * 0.52, y - r * 0.94, x + r * 0.24, y - r * 0.82);
    c.quadraticCurveTo(x + r * 0.94, y - r * 0.72, x + r * 0.86, y + r * 0.06);
    c.quadraticCurveTo(x + r * 0.8, y + r * 0.86, x + r * 0.06, y + r * 0.8);
    c.quadraticCurveTo(x - r * 0.66, y + r * 0.74, x - r * 0.86, y - r * 0.22);
    c.closePath();
  };
  steak();
  fillStroke(c, raw, PAL.ink, lw);
  c.save();
  steak();
  c.clip();
  // fat rim
  c.strokeStyle = '#f7e6d8';
  c.lineWidth = r * 0.3;
  c.beginPath();
  c.moveTo(x + r * 0.2, y - r * 0.95);
  c.quadraticCurveTo(x + r * 1.02, y - r * 0.2, x + r * 0.3, y + r * 0.94);
  c.stroke();
  c.strokeStyle = PAL.ink;
  c.lineWidth = r * 0.09;
  c.stroke();
  // marbling
  c.strokeStyle = tint(raw, 0.46);
  c.lineWidth = r * 0.11;
  c.lineCap = 'round';
  for (const [dx, dy] of [
    [-0.52, -0.16],
    [-0.3, 0.28],
    [-0.1, -0.44],
  ] as const) {
    c.beginPath();
    c.moveTo(x + r * dx, y + r * dy);
    c.quadraticCurveTo(x + r * (dx + 0.18), y + r * (dy - 0.22), x + r * (dx + 0.4), y + r * dy);
    c.stroke();
  }
  c.restore();
};

/** Loose grains raw; a steaming mound once boiled. */
const drawRice: IngredientArt = (c, ing, x, y, r) => {
  const body = INGREDIENT_COLORS.rice;
  const lw = r * 0.13;
  if (ing.cooked) {
    c.beginPath();
    c.moveTo(x - r * 0.86, y + r * 0.5);
    c.quadraticCurveTo(x - r * 0.62, y - r * 0.82, x, y - r * 0.82);
    c.quadraticCurveTo(x + r * 0.62, y - r * 0.82, x + r * 0.86, y + r * 0.5);
    c.closePath();
    fillStroke(c, body, PAL.ink, lw * 1.2);
    c.strokeStyle = shade(body, 0.16);
    c.lineWidth = r * 0.08;
    c.lineCap = 'round';
    for (const [dx, dy, a] of [
      [-0.4, 0.16, 0.5],
      [0.0, -0.24, -0.3],
      [0.38, 0.1, 0.2],
      [-0.1, 0.3, -0.6],
    ] as const) {
      c.save();
      c.translate(x + r * dx, y + r * dy);
      c.rotate(a);
      c.beginPath();
      c.moveTo(-r * 0.14, 0);
      c.lineTo(r * 0.14, 0);
      c.stroke();
      c.restore();
    }
    return;
  }
  // Loose grains, few and large: five is legible on a crate face, twelve is
  // a smudge.
  for (const [dx, dy, a] of [
    [-0.42, 0.3, 0.55],
    [-0.16, -0.28, -0.4],
    [0.34, 0.32, 0.2],
    [0.44, -0.22, 1.1],
    [0.02, 0.06, -0.05],
  ] as const) {
    c.save();
    c.translate(x + r * dx, y + r * dy);
    c.rotate(a);
    ellipse(c, 0, 0, r * 0.4, r * 0.17);
    fillStroke(c, body, PAL.ink, lw * 1.2);
    c.restore();
  }
};

/** A whole fish; pink sashimi slices once cut. */
const drawFish: IngredientArt = (c, ing, x, y, r) => {
  const body = INGREDIENT_COLORS.fish;
  const pale = INGREDIENT_ACCENTS.fish;
  const lw = r * 0.15;
  if (ing.chopped) {
    for (const [dx, dy, a] of [
      [-0.42, 0.3, -0.34],
      [0.0, -0.04, 0.08],
      [0.44, 0.3, 0.36],
    ] as const) {
      c.save();
      c.translate(x + r * dx, y + r * dy);
      c.rotate(a);
      rr(c, -r * 0.46, -r * 0.24, r * 0.92, r * 0.48, r * 0.16);
      fillStroke(c, body, PAL.ink, lw);
      // the pale striations that make salmon read as salmon
      c.strokeStyle = pale;
      c.lineWidth = r * 0.1;
      c.lineCap = 'round';
      for (const o of [-0.1, 0.06]) {
        c.beginPath();
        c.moveTo(-r * 0.32, r * o);
        c.quadraticCurveTo(0, r * (o - 0.12), r * 0.32, r * o);
        c.stroke();
      }
      c.restore();
    }
    return;
  }
  // tail
  c.beginPath();
  c.moveTo(x - r * 0.5, y);
  c.lineTo(x - r * 0.98, y - r * 0.46);
  c.lineTo(x - r * 0.98, y + r * 0.46);
  c.closePath();
  fillStroke(c, shade(body, 0.14), PAL.ink, lw);
  // body
  c.beginPath();
  c.moveTo(x - r * 0.6, y);
  c.quadraticCurveTo(x - r * 0.1, y - r * 0.72, x + r * 0.62, y - r * 0.22);
  c.quadraticCurveTo(x + r * 1.0, y, x + r * 0.62, y + r * 0.22);
  c.quadraticCurveTo(x - r * 0.1, y + r * 0.72, x - r * 0.6, y);
  c.closePath();
  fillStroke(c, body, PAL.ink, lw);
  // belly + eye
  c.save();
  c.beginPath();
  c.moveTo(x - r * 0.6, y);
  c.quadraticCurveTo(x - r * 0.1, y - r * 0.72, x + r * 0.62, y - r * 0.22);
  c.quadraticCurveTo(x + r * 1.0, y, x + r * 0.62, y + r * 0.22);
  c.quadraticCurveTo(x - r * 0.1, y + r * 0.72, x - r * 0.6, y);
  c.closePath();
  c.clip();
  c.fillStyle = pale;
  ellipse(c, x + r * 0.05, y + r * 0.34, r * 0.62, r * 0.26);
  c.fill();
  c.restore();
  circle(c, x + r * 0.5, y - r * 0.1, r * 0.11);
  fillStroke(c, PAL.ink, null, 0);
};

/** A sheet of nori: dark, matte, with a faint fibre grain. */
const drawSeaweed: IngredientArt = (c, _ing, x, y, r) => {
  const body = INGREDIENT_COLORS.seaweed;
  const lw = r * 0.15;
  rr(c, x - r * 0.8, y - r * 0.72, r * 1.6, r * 1.44, r * 0.22);
  fillStroke(c, body, PAL.ink, lw);
  c.save();
  rr(c, x - r * 0.8, y - r * 0.72, r * 1.6, r * 1.44, r * 0.22);
  c.clip();
  // pressed fibres, running one way only — a grid reads as a net
  c.strokeStyle = tint(body, 0.22);
  c.lineWidth = r * 0.05;
  for (let i = -2; i <= 2; i++) {
    c.beginPath();
    c.moveTo(x - r * 0.9, y + r * i * 0.3);
    c.quadraticCurveTo(x, y + r * (i * 0.3 - 0.06), x + r * 0.9, y + r * i * 0.3);
    c.stroke();
  }
  // a sheen across one corner, so the sheet is not a hole in the world
  c.globalAlpha = 0.2;
  c.beginPath();
  c.moveTo(x - r * 0.9, y - r * 0.16);
  c.lineTo(x - r * 0.16, y - r * 0.9);
  c.lineTo(x + r * 0.34, y - r * 0.9);
  c.lineTo(x - r * 0.9, y + r * 0.36);
  c.closePath();
  c.fillStyle = '#ffffff';
  c.fill();
  c.restore();
  // a lifted corner: the sheet has a front and a back
  c.beginPath();
  c.moveTo(x + r * 0.8, y + r * 0.32);
  c.lineTo(x + r * 0.8, y + r * 0.72);
  c.lineTo(x + r * 0.36, y + r * 0.72);
  c.closePath();
  fillStroke(c, tint(body, 0.34), PAL.ink, lw * 0.8);
};

/** The whole food registry. Adding an ingredient means adding one entry. */
const ART: Record<IngredientType, IngredientArt> = {
  onion: drawOnion,
  tomato: drawTomato,
  mushroom: drawMushroom,
  lettuce: drawLettuce,
  cheese: drawCheese,
  bun: drawBun,
  meat: drawMeat,
  rice: drawRice,
  fish: drawFish,
  seaweed: drawSeaweed,
};

export function drawIngredient(
  c: CanvasRenderingContext2D,
  ing: IngredientView,
  x: number,
  y: number,
  r: number,
  time = 0,
): void {
  ART[ing.type](c, ing, x, y, r, time);
}

/** Blended soup surface colour for a set of ingredients. */
export function soupColor(contents: readonly IngredientType[]): string {
  if (contents.length === 0) return '#e8c88a';
  let acc: string = INGREDIENT_COLORS[contents[0]!];
  for (let i = 1; i < contents.length; i++) {
    acc = mix(acc, INGREDIENT_COLORS[contents[i]!], 1 / (i + 1));
  }
  return mix(acc, '#c8843c', 0.32);
}

/* --------------------------------- plates -------------------------------- */

/**
 * How a plate of these parts should be presented. The catalogue decides: a
 * plate of boiled things is a bowl of soup, a bun means a burger stack, rice
 * means sushi, and anything else is arranged as a salad.
 */
function plateStyle(parts: readonly IngredientType[]): 'empty' | 'soup' | 'burger' | 'sushi' | 'salad' {
  if (parts.length === 0) return 'empty';
  if (parts.includes('bun')) return 'burger';
  if (parts.includes('rice')) return 'sushi';
  if (parts.every((p) => INGREDIENTS[p].cook === 'boil')) return 'soup';
  return 'salad';
}

/** Bun heel, patty, cheese, lettuce, bun crown — always in that order. */
const BURGER_LAYERS: IngredientType[] = ['meat', 'cheese', 'lettuce', 'tomato'];

function drawBurgerStack(
  c: CanvasRenderingContext2D,
  parts: readonly IngredientType[],
  x: number,
  y: number,
  r: number,
): void {
  const lw = r * 0.1;
  const hasBun = parts.includes('bun');
  const fillings = BURGER_LAYERS.filter((p) => parts.includes(p));
  // The stack is built bottom-up; everything shifts down as it grows so a
  // deluxe burger stays inside the plate.
  const step = r * 0.2;
  let ly = y + r * 0.18 - (fillings.length * step) / 2;

  if (hasBun) {
    rr(c, x - r * 0.56, ly + r * 0.06, r * 1.12, r * 0.3, r * 0.14);
    fillStroke(c, shade(INGREDIENT_COLORS.bun, 0.14), PAL.ink, lw);
  }
  for (const p of fillings) {
    ly -= step;
    if (p === 'meat') {
      ellipse(c, x, ly + r * 0.06, r * 0.56, r * 0.19);
      fillStroke(c, INGREDIENT_ACCENTS.meat, PAL.ink, lw);
      c.strokeStyle = shade(INGREDIENT_ACCENTS.meat, 0.4);
      c.lineWidth = r * 0.07;
      c.lineCap = 'round';
      for (const o of [-0.2, 0.16]) {
        c.beginPath();
        c.moveTo(x + r * (o - 0.1), ly);
        c.lineTo(x + r * (o + 0.16), ly + r * 0.1);
        c.stroke();
      }
      continue;
    }
    if (p === 'cheese') {
      c.beginPath();
      c.moveTo(x - r * 0.56, ly + r * 0.06);
      c.lineTo(x + r * 0.56, ly + r * 0.06);
      c.lineTo(x + r * 0.4, ly + r * 0.26);
      c.lineTo(x - r * 0.42, ly + r * 0.24);
      c.closePath();
      fillStroke(c, INGREDIENT_COLORS.cheese, PAL.ink, lw);
      continue;
    }
    // leafy fillings: a frilly band
    c.beginPath();
    c.moveTo(x - r * 0.58, ly + r * 0.08);
    for (let i = 0; i <= 4; i++) {
      const px = x - r * 0.58 + (r * 1.16 * i) / 4;
      c.quadraticCurveTo(px + r * 0.14, ly + (i % 2 === 0 ? -r * 0.12 : r * 0.16), px + r * 0.29, ly + r * 0.06);
    }
    c.lineTo(x + r * 0.5, ly + r * 0.2);
    c.lineTo(x - r * 0.5, ly + r * 0.2);
    c.closePath();
    fillStroke(c, p === 'lettuce' ? INGREDIENT_COLORS.lettuce : INGREDIENT_COLORS.tomato, PAL.ink, lw);
  }
  if (hasBun) {
    ly -= step * 1.1;
    c.beginPath();
    c.moveTo(x - r * 0.6, ly + r * 0.12);
    c.quadraticCurveTo(x - r * 0.56, ly - r * 0.44, x, ly - r * 0.44);
    c.quadraticCurveTo(x + r * 0.56, ly - r * 0.44, x + r * 0.6, ly + r * 0.12);
    c.closePath();
    fillStroke(c, INGREDIENT_COLORS.bun, PAL.ink, lw);
    c.fillStyle = INGREDIENT_ACCENTS.bun;
    for (const [dx, dy] of [
      [-0.28, -0.1],
      [0.0, -0.22],
      [0.28, -0.08],
    ] as const) {
      ellipse(c, x + r * dx, ly + r * dy, r * 0.08, r * 0.04);
      c.fill();
    }
  }
}

/** Two pieces of sushi: maki rounds when there is nori, else nigiri. */
function drawSushiPlate(
  c: CanvasRenderingContext2D,
  parts: readonly IngredientType[],
  x: number,
  y: number,
  r: number,
): void {
  const lw = r * 0.09;
  const roll = parts.includes('seaweed');
  const filling = parts.find((p) => p !== 'rice' && p !== 'seaweed');
  for (const dx of [-0.3, 0.3]) {
    const px = x + r * dx;
    const py = y + (dx < 0 ? r * 0.06 : -r * 0.04);
    if (roll) {
      circle(c, px, py, r * 0.3);
      fillStroke(c, INGREDIENT_COLORS.seaweed, PAL.ink, lw);
      circle(c, px, py, r * 0.22);
      fillStroke(c, INGREDIENT_COLORS.rice, null, 0);
      if (filling) {
        circle(c, px, py, r * 0.1);
        fillStroke(c, INGREDIENT_COLORS[filling], null, 0);
      }
      continue;
    }
    // nigiri: a rice pillow with a slice laid over it. The slice is a slab,
    // not a sliver: pale fish on white rice needs an outline to exist at all.
    rr(c, px - r * 0.28, py - r * 0.04, r * 0.56, r * 0.3, r * 0.13);
    fillStroke(c, INGREDIENT_COLORS.rice, PAL.ink, lw);
    if (filling) {
      c.save();
      c.translate(px, py - r * 0.1);
      c.rotate(-0.12);
      rr(c, -r * 0.32, -r * 0.14, r * 0.64, r * 0.26, r * 0.11);
      fillStroke(c, INGREDIENT_COLORS[filling], PAL.ink, lw);
      c.strokeStyle = INGREDIENT_ACCENTS[filling];
      c.lineWidth = r * 0.05;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-r * 0.2, 0);
      c.quadraticCurveTo(0, -r * 0.08, r * 0.2, 0);
      c.stroke();
      c.restore();
    }
  }
}

/**
 * Plate seen from slightly above. `parts` empty (or null) means a clean plate.
 * Everything is drawn inside the well, so a plate reads the same in a hand, on
 * a counter and in the plate stack.
 */
export function drawPlate(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  contents: readonly Ingredient[] | null,
  time = 0,
): void {
  const parts = (contents ?? []).map((p) => p.type);
  const style = plateStyle(parts);
  const lw = r * 0.14;
  ellipse(c, x, y, r, r * 0.8);
  fillStroke(c, PAL.plate, PAL.ink, lw);
  ellipse(c, x, y, r * 0.72, r * 0.55);
  fillStroke(c, style === 'empty' ? PAL.plateShade : shade(PAL.plateShade, 0.05), null, 0);

  if (style === 'empty') {
    c.save();
    c.globalAlpha = 0.7;
    ellipse(c, x - r * 0.35, y - r * 0.28, r * 0.2, r * 0.09);
    c.fillStyle = '#fff';
    c.fill();
    c.restore();
    return;
  }

  if (style === 'soup') {
    const col = soupColor(parts);
    ellipse(c, x, y, r * 0.66, r * 0.5);
    fillStroke(c, col, shade(col, 0.35), lw * 0.7);
    for (let i = 0; i < parts.length; i++) {
      const a = (i / parts.length) * Math.PI * 2 + 0.6;
      circle(c, x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.2, r * 0.13);
      c.fillStyle = tint(INGREDIENT_COLORS[parts[i]!], 0.12);
      c.fill();
    }
    c.save();
    c.globalAlpha = 0.5;
    ellipse(c, x - r * 0.28, y - r * 0.18, r * 0.16, r * 0.07);
    c.fillStyle = '#fff';
    c.fill();
    c.restore();
    return;
  }

  if (style === 'burger') {
    drawBurgerStack(c, parts, x, y, r);
    return;
  }
  if (style === 'sushi') {
    drawSushiPlate(c, parts, x, y, r);
    return;
  }

  // salad: the prepared parts, arranged around the well
  const n = parts.length;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(a) * r * (n > 1 ? 0.26 : 0);
    const py = y + Math.sin(a) * r * (n > 1 ? 0.17 : 0);
    const part = contents![i]!;
    drawIngredient(c, part, px, py, r * 0.34, time);
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
    const col = burnt ? '#241d18' : soupColor(pot.contents.map((i) => i.type));
    ellipse(c, 0, -0.19, 0.275, 0.088);
    fillStroke(c, col, shade(col, 0.4), OUT * 0.6);
    if (!burnt) {
      for (let i = 0; i < pot.contents.length; i++) {
        const a = (i / pot.contents.length) * Math.PI * 2 + time * 0.6;
        circle(c, Math.cos(a) * 0.125, -0.19 + Math.sin(a) * 0.036, 0.04);
        c.fillStyle = tint(INGREDIENT_COLORS[pot.contents[i]!.type], 0.15);
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

  // fill pips: how many of the pot's slots are used
  for (let i = 0; i < POT_CAPACITY; i++) {
    const px = (i - (POT_CAPACITY - 1) / 2) * 0.15;
    circle(c, px, 0.43, 0.048);
    const ing = pot.contents[i];
    fillStroke(c, ing ? INGREDIENT_COLORS[ing.type] : 'rgba(24,14,8,0.55)', PAL.ink, OUT * 0.65);
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
 * A frying pan, wherever it is. Same contract as `drawPot`: `size` is the
 * width of the body, `onHeat` says whether its timers are actually running.
 *
 * A skillet is read from a shallower angle than a pot — you see into it — so
 * whatever is frying is drawn with the ordinary ingredient art rather than
 * hidden behind a rim.
 */
export function drawPan(
  c: CanvasRenderingContext2D,
  pot: Pot,
  x: number,
  y: number,
  size: number,
  time: number,
  onHeat = true,
): void {
  const k = size / PAN_SIZE;
  const burnt = pot.state === 'burnt';
  const done = pot.state === 'done';
  const OUT = POT_OUT;

  c.save();
  c.translate(x, y);
  c.scale(k, k);

  if (done) {
    const g = c.createRadialGradient(0, 0, 0.05, 0, 0, 0.7);
    g.addColorStop(0, 'rgba(80, 235, 150, 0.6)');
    g.addColorStop(1, 'rgba(80, 235, 150, 0)');
    c.fillStyle = g;
    c.fillRect(-0.75, -0.75, 1.5, 1.5);
  }

  // handle, out to the right and slightly down, behind the body
  c.beginPath();
  c.moveTo(0.2, 0.04);
  c.lineTo(0.46, 0.12);
  c.strokeStyle = PAL.ink;
  c.lineWidth = 0.16;
  c.lineCap = 'round';
  c.stroke();
  // a wooden handle, not a black one: on a dark stove a black rod disappears
  c.strokeStyle = '#8a5c34';
  c.lineWidth = 0.1;
  c.stroke();
  c.strokeStyle = 'rgba(255,236,206,0.4)';
  c.lineWidth = 0.026;
  c.beginPath();
  c.moveTo(0.22, 0.005);
  c.lineTo(0.44, 0.08);
  c.stroke();

  // body: a shallow dish of thick iron, sitting a little left of the ring so
  // the handle has somewhere to go
  const cx = -0.05;
  ellipse(c, cx, 0.06, 0.33, 0.15);
  fillStroke(c, '#1b1e23', PAL.ink, OUT);
  ellipse(c, cx, 0, 0.33, 0.15);
  const bg = c.createLinearGradient(0, -0.15, 0, 0.15);
  bg.addColorStop(0, burnt ? '#33271d' : '#535b66');
  bg.addColorStop(1, burnt ? '#181310' : '#272c33');
  fillStroke(c, bg, PAL.ink, OUT);
  // rim highlight, so a black pan reads against a grey stove
  c.beginPath();
  c.ellipse(cx, 0, 0.33, 0.15, 0, Math.PI * 1.05, Math.PI * 1.95);
  c.strokeStyle = 'rgba(255,246,227,0.5)';
  c.lineWidth = 0.035;
  c.stroke();
  // cooking surface
  ellipse(c, cx, 0.012, 0.25, 0.105);
  fillStroke(c, burnt ? '#0f0c0a' : '#20242a', null, 0);

  if (pot.contents.length > 0) {
    const ing = pot.contents[0]!;
    if (burnt) {
      ellipse(c, cx, 0, 0.16, 0.07);
      fillStroke(c, '#241d18', '#0d0b0a', OUT * 0.6);
    } else {
      drawIngredient(c, ing, cx, -0.01, 0.16, time);
    }
  }

  // fill pip: a pan is one slot, and it either has something in it or not
  for (let i = 0; i < PAN_CAPACITY; i++) {
    circle(c, -0.05, 0.28, 0.048);
    const ing = pot.contents[i];
    fillStroke(c, ing ? INGREDIENT_COLORS[ing.type] : 'rgba(24,14,8,0.55)', PAL.ink, OUT * 0.65);
  }

  if (pot.state === 'cooking') {
    if (onHeat) {
      const frac = clamp(pot.cookMs / FRY_MS, 0, 1);
      c.beginPath();
      c.arc(-0.05, 0, 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      c.strokeStyle = PAL.amber;
      c.lineWidth = 0.075;
      c.lineCap = 'round';
      c.stroke();
    }
    // sizzle: little sparks hopping off the surface
    for (let i = 0; i < 5; i++) {
      const t = (time * 1.5 + i * 0.2) % 1;
      const sx = -0.05 + Math.sin((i + 1) * 2.7) * 0.2;
      c.globalAlpha = 0.85 * (1 - t);
      circle(c, sx, -0.03 - t * 0.2, 0.022 + t * 0.012);
      c.fillStyle = i % 2 === 0 ? '#ffd88a' : '#fff3d0';
      c.fill();
    }
    c.globalAlpha = 1;
  } else if (done) {
    if (onHeat) {
      const since = pot.cookMs >= FRY_MS ? pot.cookMs - FRY_MS : pot.cookMs;
      const left = clamp(1 - since / BURN_MS, 0, 1);
      c.beginPath();
      c.arc(-0.05, 0, 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      c.strokeStyle = left > 0.35 ? '#4ce08c' : PAL.tomato;
      c.lineWidth = 0.075;
      c.lineCap = 'round';
      c.stroke();
    }
    drawSteam(c, -0.05, -0.18, 0.14, time, 'rgba(190,255,215,0.85)');
  } else if (burnt) {
    for (let i = 0; i < 4; i++) {
      const t = (time * 0.42 + i * 0.25) % 1;
      c.globalAlpha = 0.62 * (1 - t);
      circle(c, -0.05 + Math.sin((t + i) * 4.1) * 0.14, -0.16 - t * 0.55, 0.06 + t * 0.14);
      c.fillStyle = '#1b1512';
      c.fill();
    }
    c.globalAlpha = 1;
  }

  c.restore();
}

/** Either piece of cookware, by its kind. One call site, two looks. */
export function drawVessel(
  c: CanvasRenderingContext2D,
  pot: Pot,
  x: number,
  y: number,
  size: number,
  time: number,
  onHeat = true,
): void {
  if (pot.kind === 'pan') drawPan(c, pot, x, y, size, time, onHeat);
  else drawPot(c, pot, x, y, size, time, onHeat);
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
      drawPlate(c, x, y, r, item.contents, time);
      return;
    case 'ingredient':
      drawIngredient(c, item.ing, x, y, r * 0.86, time);
      return;
    case 'pot':
      // Both hands: cookware is heavier and wider than a plate, and it hangs a
      // little lower. Off the ring, so no cooking dial.
      drawVessel(c, item.pot, x, y + r * 0.16, r * 2.6, time, false);
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
/**
 * Backing disc for a ticket icon. Tinting the ingredient's own colour keeps
 * each icon on-theme, but rice on a near-white disc is invisible — so pale
 * ingredients get a darkened disc instead of a lightened one.
 */
function iconDisc(type: IngredientType): string {
  const hex = INGREDIENT_COLORS[type].replace('#', '');
  const lum =
    (0.299 * parseInt(hex.slice(0, 2), 16) +
      0.587 * parseInt(hex.slice(2, 4), 16) +
      0.114 * parseInt(hex.slice(4, 6), 16)) /
    255;
  const body = INGREDIENT_COLORS[type];
  return lum > 0.88 ? shade(body, 0.24) : tint(body, 0.72);
}

export function drawTicketIcon(
  c: CanvasRenderingContext2D,
  type: IngredientType,
  x: number,
  y: number,
  r: number,
): void {
  c.save();
  circle(c, x, y, r * 1.16);
  fillStroke(c, iconDisc(type), PAL.ink, r * 0.13);
  // Raw, as it comes out of the crate: a ticket tells you where to run.
  drawIngredient(c, { type, chopped: false, cooked: false }, x, y, r * 0.82);
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
