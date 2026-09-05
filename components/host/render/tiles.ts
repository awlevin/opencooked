// Kitchen geometry: the floor of a world and the stations that sit on it.
// Every tile is drawn inside a 0..1 unit box (the caller scales by tile size),
// so line widths and radii are expressed as fractions of a tile.
//
// Every function here takes the level's `WorldTheme`: the counters, the ink
// and the floor are the world's, while the crates, the steel and the food keep
// the world-independent colours in `theme.ts`.

import { rawIngredient, type IngredientType } from '@/shared/catalogue';
import type { WorldTheme } from '@/shared/levels';
import {
  CHOP_MS,
  EXTINGUISH_MS,
  type Fire,
  type Snapshot,
  type Tile,
} from '@/shared/types';
import {
  drawBurner,
  drawExtinguisher,
  drawHeldItem,
  drawPlate,
  drawVessel,
} from './ingredients';
import { drawMotifFloor } from './motifs';
import { PAL, circle, clamp, fillStroke, rr, shade } from './theme';

const OUT = 0.055; // outline width, tile units

/** The floor of one kitchen, in that world's colours (board-local pixels). */
export function drawFloor(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  T: number,
  theme: WorldTheme,
  time: number,
): void {
  const W = w * T;
  const H = h * T;
  drawMotifFloor(c, theme, W, H, T, time);
  // inner shading so the room feels like a room
  const vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, theme.vignette);
  c.fillStyle = vg;
  c.fillRect(0, 0, W, H);
}

/**
 * The counter slab every station stands on, in the world's counter colours.
 * `top`/`bottom` override them for a station that is the same everywhere —
 * a range is steel in every kitchen, never cabinetry.
 */
function slab(
  c: CanvasRenderingContext2D,
  theme: WorldTheme,
  top: string = theme.counterTop,
  bottom: string = theme.counterBottom,
): void {
  rr(c, 0.02, 0.1, 0.96, 0.9, 0.16);
  c.fillStyle = theme.shadow;
  c.fill();
  const g = c.createLinearGradient(0, 0.02, 0, 0.94);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  rr(c, 0.02, 0.02, 0.96, 0.9, 0.16);
  fillStroke(c, g, theme.ink, OUT);
  rr(c, 0.12, 0.09, 0.76, 0.14, 0.07);
  c.fillStyle = 'rgba(255,255,255,0.28)';
  c.fill();
}

function drawKnife(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  a: number,
  ink: string,
): void {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  c.beginPath();
  c.moveTo(-s * 0.9, -s * 0.16);
  c.lineTo(s * 0.25, -s * 0.24);
  c.lineTo(s * 0.32, s * 0.1);
  c.lineTo(-s * 0.9, s * 0.14);
  c.closePath();
  fillStroke(c, '#dfe6ee', ink, OUT * 0.9);
  rr(c, s * 0.3, -s * 0.16, s * 0.62, s * 0.3, s * 0.12);
  fillStroke(c, '#3f2a1c', ink, OUT * 0.9);
  c.restore();
}

function progressBar(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  fill: string,
  ink: string,
): void {
  rr(c, x, y, w, h, h / 2);
  fillStroke(c, 'rgba(60,38,20,0.55)', ink, OUT * 0.7);
  const fw = Math.max(0, Math.min(1, frac)) * (w - h * 0.3);
  if (fw > 0.001) {
    rr(c, x + h * 0.15, y + h * 0.16, Math.max(fw, h * 0.7), h * 0.68, h * 0.34);
    c.fillStyle = fill;
    c.fill();
  }
}

function drawCrate(c: CanvasRenderingContext2D, kind: IngredientType, theme: WorldTheme): void {
  rr(c, 0.02, 0.12, 0.96, 0.9, 0.14);
  c.fillStyle = theme.shadow;
  c.fill();
  const g = c.createLinearGradient(0, 0, 0, 1);
  g.addColorStop(0, PAL.crate);
  g.addColorStop(1, shade(PAL.crateDark, 0.18));
  rr(c, 0.02, 0.04, 0.96, 0.9, 0.12);
  fillStroke(c, g, theme.ink, OUT);
  // slats: light planks top and bottom, dark grooves between
  c.fillStyle = 'rgba(255, 226, 178, 0.3)';
  for (const y of [0.08, 0.74]) {
    rr(c, 0.07, y, 0.86, 0.16, 0.05);
    c.fill();
  }
  c.strokeStyle = 'rgba(48,26,10,0.5)';
  c.lineWidth = OUT * 0.8;
  c.beginPath();
  for (const y of [0.26, 0.7]) {
    c.moveTo(0.06, y);
    c.lineTo(0.94, y);
  }
  // corner brace
  c.moveTo(0.1, 0.68);
  c.lineTo(0.9, 0.28);
  c.stroke();
  // the goods, sitting proud of the box
  drawHeldItem(c, { kind: 'ingredient', ing: rawIngredient(kind) }, 0.5, 0.48, 0.33);
}

function drawBoard(c: CanvasRenderingContext2D, tile: Tile, theme: WorldTheme): void {
  slab(c, theme);
  rr(c, 0.11, 0.2, 0.78, 0.6, 0.09);
  fillStroke(c, PAL.board, PAL.boardEdge, OUT * 0.9);
  c.strokeStyle = 'rgba(120,80,40,0.28)';
  c.lineWidth = OUT * 0.5;
  c.beginPath();
  for (const y of [0.34, 0.5, 0.66]) {
    c.moveTo(0.18, y);
    c.lineTo(0.82, y);
  }
  c.stroke();

  const item = tile.item;
  const chopping = (tile.chopMs ?? 0) > 0;
  // The board's resting knife is the "this is a board" cue; while a chef is
  // chopping, their own animated knife takes over so we hide this one.
  if (!chopping) drawKnife(c, 0.75, 0.3, 0.24, -0.55, theme.ink);

  if (item) drawHeldItem(c, item, 0.45, 0.46, 0.26);

  if (chopping) {
    progressBar(c, 0.15, 0.66, 0.7, 0.16, (tile.chopMs ?? 0) / CHOP_MS, PAL.mint, theme.ink);
  }
}

function drawPlates(c: CanvasRenderingContext2D, theme: WorldTheme): void {
  slab(c, theme);
  for (let i = 3; i >= 0; i--) {
    drawPlate(c, 0.5, 0.62 - i * 0.075, 0.3, null);
  }
}

function drawServe(c: CanvasRenderingContext2D, time: number, theme: WorldTheme): void {
  rr(c, 0.02, 0.1, 0.96, 0.9, 0.16);
  c.fillStyle = theme.shadow;
  c.fill();
  rr(c, 0.02, 0.02, 0.96, 0.9, 0.16);
  fillStroke(c, PAL.metal, theme.ink, OUT);

  // the hatch opening, warm light spilling out
  const g = c.createLinearGradient(0, 0.12, 0, 0.72);
  g.addColorStop(0, '#2a1b12');
  g.addColorStop(1, '#ffca6a');
  rr(c, 0.14, 0.14, 0.72, 0.56, 0.08);
  fillStroke(c, g, theme.ink, OUT * 0.9);

  // rolled shutter
  rr(c, 0.12, 0.06, 0.76, 0.2, 0.07);
  fillStroke(c, PAL.metalHi, theme.ink, OUT * 0.9);
  c.strokeStyle = 'rgba(40,26,16,0.45)';
  c.lineWidth = OUT * 0.5;
  c.beginPath();
  for (const y of [0.115, 0.16, 0.205]) {
    c.moveTo(0.16, y);
    c.lineTo(0.84, y);
  }
  c.stroke();

  // chevrons: "push plates through here"
  const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
  c.strokeStyle = `rgba(255, 240, 190, ${0.45 + pulse * 0.5})`;
  c.lineWidth = 0.07;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (let i = 0; i < 2; i++) {
    const y = 0.56 - i * 0.14 - pulse * 0.02;
    c.beginPath();
    c.moveTo(0.34, y);
    c.lineTo(0.5, y - 0.11);
    c.lineTo(0.66, y);
    c.stroke();
  }

  // service lip
  rr(c, 0.04, 0.68, 0.92, 0.24, 0.08);
  fillStroke(c, theme.counterFace, theme.ink, OUT);
}

function drawTrash(c: CanvasRenderingContext2D, theme: WorldTheme): void {
  rr(c, 0.08, 0.2, 0.84, 0.82, 0.16);
  c.fillStyle = theme.shadow;
  c.fill();
  // tapered body
  c.beginPath();
  c.moveTo(0.16, 0.26);
  c.lineTo(0.84, 0.26);
  c.lineTo(0.76, 0.9);
  c.quadraticCurveTo(0.5, 0.99, 0.24, 0.9);
  c.closePath();
  const g = c.createLinearGradient(0.16, 0, 0.84, 0);
  g.addColorStop(0, PAL.binDark);
  g.addColorStop(0.45, PAL.bin);
  g.addColorStop(1, PAL.binDark);
  fillStroke(c, g, theme.ink, OUT);
  c.strokeStyle = 'rgba(20,30,24,0.4)';
  c.lineWidth = OUT * 0.7;
  c.beginPath();
  for (const x of [0.38, 0.5, 0.62]) {
    c.moveTo(x, 0.34);
    c.lineTo(x - (x - 0.5) * -0.14, 0.84);
  }
  c.stroke();
  // lid
  rr(c, 0.1, 0.14, 0.8, 0.16, 0.08);
  fillStroke(c, PAL.binLid, theme.ink, OUT);
  rr(c, 0.42, 0.05, 0.16, 0.1, 0.05);
  fillStroke(c, PAL.binLid, theme.ink, OUT * 0.9);
}

/** Wall bracket for the one extinguisher in the kitchen. */
function drawExtinguisherMount(
  c: CanvasRenderingContext2D,
  tile: Tile,
  time: number,
  theme: WorldTheme,
): void {
  slab(c, theme);
  // red backing plate, so an empty bracket still shouts "this is where it goes"
  rr(c, 0.2, 0.14, 0.6, 0.74, 0.1);
  fillStroke(c, '#9c2b20', theme.ink, OUT * 0.9);
  rr(c, 0.26, 0.2, 0.48, 0.62, 0.07);
  fillStroke(c, 'rgba(255, 226, 178, 0.18)', null, 0);

  const stocked = tile.item?.kind === 'extinguisher';
  if (stocked) {
    drawExtinguisher(c, 0.5, 0.5, 0.34, time);
  } else {
    // Empty bracket: the painted silhouette still says what belongs here.
    rr(c, 0.39, 0.3, 0.22, 0.42, 0.07);
    fillStroke(c, 'rgba(255, 246, 227, 0.3)', null, 0);
    rr(c, 0.44, 0.22, 0.12, 0.07, 0.03);
    fillStroke(c, 'rgba(255, 246, 227, 0.3)', null, 0);
  }

  // two straps across the bottle
  c.strokeStyle = PAL.metalHi;
  c.lineWidth = 0.075;
  c.lineCap = 'round';
  for (const y of [0.36, 0.68]) {
    c.beginPath();
    c.moveTo(0.28, y);
    c.lineTo(0.72, y);
    c.stroke();
  }
  c.strokeStyle = theme.ink;
  c.lineWidth = 0.022;
  for (const y of [0.36, 0.68]) {
    c.beginPath();
    c.moveTo(0.28, y);
    c.lineTo(0.72, y);
    c.stroke();
  }
}

/**
 * A tile on fire: glow on the floor, smoke, and a few flickering tongues.
 * Fire never goes out on its own, so this has to keep reading as urgent for
 * as long as it burns.
 */
export function drawFire(
  c: CanvasRenderingContext2D,
  fire: Fire,
  x: number,
  y: number,
  size: number,
  time: number,
): void {
  const s = size;
  c.save();
  c.translate(x, y);

  // heat glow spilling onto the neighbouring floor
  const glow = 0.9 + 0.1 * Math.sin(time * 7.7);
  const g = c.createRadialGradient(0, 0, 0.06 * s, 0, 0, 1.05 * s * glow);
  g.addColorStop(0, 'rgba(255, 170, 60, 0.55)');
  g.addColorStop(0.55, 'rgba(255, 120, 30, 0.22)');
  g.addColorStop(1, 'rgba(255, 110, 20, 0)');
  c.fillStyle = g;
  c.fillRect(-1.1 * s, -1.1 * s, 2.2 * s, 2.2 * s);

  // smoke, behind the flames
  for (let i = 0; i < 5; i++) {
    const t = (time * 0.34 + i * 0.2) % 1;
    c.globalAlpha = 0.42 * (1 - t);
    circle(c, Math.sin((t + i) * 3.7) * 0.2 * s, (-0.32 - t * 0.95) * s, (0.09 + t * 0.2) * s);
    c.fillStyle = '#241c18';
    c.fill();
  }
  c.globalAlpha = 1;

  // tongues, back to front: dark red outside, white-hot core
  const tongues = [
    { dx: -0.28, w: 0.4, h: 0.62, col: '#c9351f', ph: 0.0, ink: true },
    { dx: 0.29, w: 0.38, h: 0.56, col: '#e8503a', ph: 1.4, ink: true },
    { dx: 0.02, w: 0.5, h: 0.92, col: '#f7871f', ph: 2.7, ink: true },
    { dx: -0.03, w: 0.3, h: 0.58, col: '#ffc94a', ph: 4.1, ink: false },
    { dx: 0.01, w: 0.15, h: 0.32, col: '#fff2c4', ph: 5.2, ink: false },
  ];
  for (const t of tongues) {
    const h = t.h * s * (0.86 + 0.18 * Math.sin(time * 9 + t.ph));
    const w = t.w * s * (0.94 + 0.1 * Math.sin(time * 13 + t.ph * 2));
    const lean = Math.sin(time * 5.5 + t.ph) * 0.1 * s;
    const bx = t.dx * s;
    const by = 0.34 * s;
    c.beginPath();
    c.moveTo(bx - w / 2, by);
    c.quadraticCurveTo(bx - w * 0.72, by - h * 0.52, bx + lean, by - h);
    c.quadraticCurveTo(bx + w * 0.72, by - h * 0.46, bx + w / 2, by);
    c.quadraticCurveTo(bx, by + h * 0.1, bx - w / 2, by);
    c.closePath();
    fillStroke(c, t.col, t.ink ? PAL.ink : null, t.ink ? OUT * 0.7 * s : 0);
  }

  // how much foam has landed, as a ring round the tile
  if (fire.sprayMs > 0) {
    const frac = clamp(fire.sprayMs / EXTINGUISH_MS, 0, 1);
    c.beginPath();
    c.arc(0, 0, 0.46 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    c.strokeStyle = '#eaf6ff';
    c.lineWidth = 0.09 * s;
    c.lineCap = 'round';
    c.stroke();
  }
  c.restore();
}

/** One station tile, drawn into the unit box, in this world's colours. */
export function drawTile(
  c: CanvasRenderingContext2D,
  tile: Tile,
  time: number,
  theme: WorldTheme,
): void {
  switch (tile.t) {
    case 'floor':
      return;
    case 'counter': {
      slab(c, theme);
      const item = tile.item;
      // A pot parked on a counter is drawn at cookware scale, not item scale,
      // and without the cooking dial: nothing cooks off the ring.
      if (item?.kind === 'pot') drawVessel(c, item.pot, 0.5, 0.5, 0.62, time, false);
      else if (item) drawHeldItem(c, item, 0.5, 0.44, 0.28, time);
      return;
    }
    case 'crate':
      drawCrate(c, tile.crate ?? 'onion', theme);
      return;
    case 'board':
      drawBoard(c, tile, theme);
      return;
    case 'stove':
      slab(c, theme, PAL.metalHi, PAL.metalDark);
      // The ring is always there; the pot may have been carried off.
      drawBurner(c, 0.5, 0.5, 0.66, time);
      if (tile.pot) drawVessel(c, tile.pot, 0.5, 0.5, 0.66, time);
      return;
    case 'plates':
      drawPlates(c, theme);
      return;
    case 'serve':
      drawServe(c, time, theme);
      return;
    case 'trash':
      drawTrash(c, theme);
      return;
    case 'extinguisher':
      drawExtinguisherMount(c, tile, time, theme);
      return;
  }
}

/** Whole kitchen: floor, then every station. Caller sets board transform. */
export function drawKitchen(
  c: CanvasRenderingContext2D,
  snap: Snapshot,
  T: number,
  time: number,
  theme: WorldTheme,
): void {
  drawFloor(c, snap.w, snap.h, T, theme, time);
  for (let y = 0; y < snap.h; y++) {
    for (let x = 0; x < snap.w; x++) {
      const tile = snap.tiles[y * snap.w + x];
      if (!tile || tile.t === 'floor') continue;
      c.save();
      c.translate(x * T, y * T);
      c.scale(T, T);
      drawTile(c, tile, time, theme);
      // Flames sit on top of whatever is burning.
      if (tile.fire) drawFire(c, tile.fire, 0.5, 0.5, 1, time);
      c.restore();
    }
  }
}
