// Kitchen geometry: wooden floor and the stations that sit on it.
// Every tile is drawn inside a 0..1 unit box (the caller scales by tile size),
// so line widths and radii are expressed as fractions of a tile.

import {
  BURN_MS,
  CHOP_MS,
  COOK_MS,
  POT_CAPACITY,
  type IngredientType,
  type Pot,
  type Snapshot,
  type Tile,
} from '../../../shared/types';
import {
  drawHeldItem,
  drawPlate,
  drawSteam,
  soupColor,
} from './ingredients';
import {
  INGREDIENT_COLORS,
  PAL,
  circle,
  clamp,
  ellipse,
  fillStroke,
  rr,
  shade,
  tint,
} from './theme';

const OUT = 0.055; // outline width, tile units

/** Warm plank floor covering the whole grid (board-local pixels). */
export function drawFloor(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  T: number,
): void {
  const W = w * T;
  const H = h * T;
  const plank = T * 0.62;
  const rows = Math.ceil(H / plank);
  for (let i = 0; i < rows; i++) {
    const y = i * plank;
    c.fillStyle = i % 2 === 0 ? PAL.floorA : PAL.floorB;
    c.fillRect(0, y, W, Math.min(plank, H - y));
    // seam under each plank
    c.fillStyle = PAL.floorSeam;
    c.fillRect(0, y + plank - T * 0.035, W, T * 0.035);
    // staggered butt joints
    const off = (i % 3) * T * 1.1;
    for (let x = off; x < W; x += T * 3.4) {
      c.fillRect(x, y, T * 0.035, Math.min(plank, H - y));
    }
    // grain
    c.strokeStyle = PAL.floorGrain;
    c.lineWidth = T * 0.018;
    c.beginPath();
    c.moveTo(0, y + plank * 0.34);
    for (let x = 0; x <= W; x += T * 0.5) {
      c.lineTo(x, y + plank * 0.34 + Math.sin((x / T + i) * 1.7) * T * 0.02);
    }
    c.stroke();
  }
  // inner shading so the room feels like a room
  const vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(40,20,8,0.42)');
  c.fillStyle = vg;
  c.fillRect(0, 0, W, H);
}

function slab(c: CanvasRenderingContext2D, top: string, bottom: string): void {
  rr(c, 0.02, 0.1, 0.96, 0.9, 0.16);
  c.fillStyle = PAL.shadow;
  c.fill();
  const g = c.createLinearGradient(0, 0.02, 0, 0.94);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  rr(c, 0.02, 0.02, 0.96, 0.9, 0.16);
  fillStroke(c, g, PAL.ink, OUT);
  rr(c, 0.12, 0.09, 0.76, 0.14, 0.07);
  c.fillStyle = 'rgba(255,255,255,0.45)';
  c.fill();
}

function drawKnife(c: CanvasRenderingContext2D, x: number, y: number, s: number, a: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  c.beginPath();
  c.moveTo(-s * 0.9, -s * 0.16);
  c.lineTo(s * 0.25, -s * 0.24);
  c.lineTo(s * 0.32, s * 0.1);
  c.lineTo(-s * 0.9, s * 0.14);
  c.closePath();
  fillStroke(c, '#dfe6ee', PAL.ink, OUT * 0.9);
  rr(c, s * 0.3, -s * 0.16, s * 0.62, s * 0.3, s * 0.12);
  fillStroke(c, '#3f2a1c', PAL.ink, OUT * 0.9);
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
): void {
  rr(c, x, y, w, h, h / 2);
  fillStroke(c, 'rgba(60,38,20,0.55)', PAL.ink, OUT * 0.7);
  const fw = Math.max(0, Math.min(1, frac)) * (w - h * 0.3);
  if (fw > 0.001) {
    rr(c, x + h * 0.15, y + h * 0.16, Math.max(fw, h * 0.7), h * 0.68, h * 0.34);
    c.fillStyle = fill;
    c.fill();
  }
}

function drawPot(
  c: CanvasRenderingContext2D,
  pot: Pot,
  time: number,
): void {
  const cx = 0.5;
  const cy = 0.5;
  const burnt = pot.state === 'burnt';
  const done = pot.state === 'done';

  // burner
  ellipse(c, cx, cy + 0.27, 0.38, 0.12);
  fillStroke(c, PAL.metalDark, PAL.ink, OUT * 0.8);

  if (done) {
    const g = c.createRadialGradient(cx, cy, 0.05, cx, cy, 0.66);
    g.addColorStop(0, 'rgba(80, 235, 150, 0.6)');
    g.addColorStop(1, 'rgba(80, 235, 150, 0)');
    c.fillStyle = g;
    c.fillRect(-0.1, -0.1, 1.2, 1.2);
  }

  // handles first, so the body overlaps their inner ends
  for (const s of [-1, 1]) {
    rr(c, cx + s * 0.3 - (s > 0 ? 0 : 0.13), cy - 0.04, 0.13, 0.13, 0.06);
    fillStroke(c, PAL.metalDark, PAL.ink, OUT * 0.8);
  }
  // body
  const bg = c.createLinearGradient(0, cy - 0.22, 0, cy + 0.3);
  bg.addColorStop(0, burnt ? shade(PAL.potHi, 0.45) : PAL.potHi);
  bg.addColorStop(1, burnt ? shade(PAL.pot, 0.5) : PAL.pot);
  rr(c, cx - 0.33, cy - 0.19, 0.66, 0.47, 0.13);
  fillStroke(c, bg, PAL.ink, OUT);
  // rim
  ellipse(c, cx, cy - 0.19, 0.34, 0.115);
  fillStroke(c, PAL.potRim, PAL.ink, OUT);

  // contents
  if (pot.contents.length > 0) {
    const col = burnt ? '#241d18' : soupColor(pot.contents);
    ellipse(c, cx, cy - 0.19, 0.275, 0.088);
    fillStroke(c, col, shade(col, 0.4), OUT * 0.6);
    if (!burnt) {
      for (let i = 0; i < pot.contents.length; i++) {
        const a = (i / pot.contents.length) * Math.PI * 2 + time * 0.6;
        circle(c, cx + Math.cos(a) * 0.125, cy - 0.19 + Math.sin(a) * 0.036, 0.04);
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
        circle(
          c,
          cx + Math.cos(a) * 0.15,
          cy - 0.19 + Math.sin(a) * 0.045 - t * 0.07,
          0.02 + t * 0.034,
        );
        c.fillStyle = tint(col, 0.5);
        c.fill();
      }
      c.globalAlpha = 1;
    }
  }

  // fill pips: how many of POT_CAPACITY slots are used
  for (let i = 0; i < POT_CAPACITY; i++) {
    const px = cx + (i - (POT_CAPACITY - 1) / 2) * 0.15;
    circle(c, px, 0.93, 0.048);
    const ing = pot.contents[i];
    fillStroke(
      c,
      ing ? INGREDIENT_COLORS[ing] : 'rgba(24,14,8,0.55)',
      PAL.ink,
      OUT * 0.65,
    );
  }

  // state feedback
  if (pot.state === 'cooking') {
    const frac = clamp(pot.cookMs / COOK_MS, 0, 1);
    c.beginPath();
    c.arc(cx, cy, 0.45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    c.strokeStyle = PAL.amber;
    c.lineWidth = 0.075;
    c.lineCap = 'round';
    c.stroke();
    drawSteam(c, cx, cy - 0.3, 0.15, time * 0.8, 'rgba(255,255,255,0.5)');
  } else if (done) {
    // the pot keeps a timer running toward burnt; accept either convention
    // (reset-to-zero or continuing past COOK_MS).
    const since = pot.cookMs >= COOK_MS ? pot.cookMs - COOK_MS : pot.cookMs;
    const left = clamp(1 - since / BURN_MS, 0, 1);
    c.beginPath();
    c.arc(cx, cy, 0.45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    c.strokeStyle = left > 0.35 ? '#4ce08c' : PAL.tomato;
    c.lineWidth = 0.075;
    c.lineCap = 'round';
    c.stroke();
    drawSteam(c, cx, cy - 0.32, 0.18, time, 'rgba(190,255,215,0.85)');
  } else if (burnt) {
    for (let i = 0; i < 4; i++) {
      const t = (time * 0.42 + i * 0.25) % 1;
      c.globalAlpha = 0.62 * (1 - t);
      circle(
        c,
        cx + Math.sin((t + i) * 4.1) * 0.14,
        cy - 0.26 - t * 0.55,
        0.06 + t * 0.14,
      );
      c.fillStyle = '#1b1512';
      c.fill();
    }
    c.globalAlpha = 1;
  }
}

function drawCrate(c: CanvasRenderingContext2D, kind: IngredientType): void {
  rr(c, 0.02, 0.12, 0.96, 0.9, 0.14);
  c.fillStyle = PAL.shadow;
  c.fill();
  const g = c.createLinearGradient(0, 0, 0, 1);
  g.addColorStop(0, PAL.crate);
  g.addColorStop(1, shade(PAL.crateDark, 0.18));
  rr(c, 0.02, 0.04, 0.96, 0.9, 0.12);
  fillStroke(c, g, PAL.ink, OUT);
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
  drawHeldItem(c, { kind: 'ingredient', ing: { type: kind, chopped: false } }, 0.5, 0.48, 0.33);
}

function drawBoard(c: CanvasRenderingContext2D, tile: Tile): void {
  slab(c, PAL.counterHi, PAL.counterEdge);
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
  if (!chopping) drawKnife(c, 0.75, 0.3, 0.24, -0.55);

  if (item) drawHeldItem(c, item, 0.45, 0.46, 0.26);

  if (chopping) {
    progressBar(c, 0.15, 0.66, 0.7, 0.16, (tile.chopMs ?? 0) / CHOP_MS, PAL.mint);
  }
}

function drawPlates(c: CanvasRenderingContext2D): void {
  slab(c, PAL.counterHi, PAL.counterEdge);
  for (let i = 3; i >= 0; i--) {
    drawPlate(c, 0.5, 0.62 - i * 0.075, 0.3, null);
  }
}

function drawServe(c: CanvasRenderingContext2D, time: number): void {
  rr(c, 0.02, 0.1, 0.96, 0.9, 0.16);
  c.fillStyle = PAL.shadow;
  c.fill();
  rr(c, 0.02, 0.02, 0.96, 0.9, 0.16);
  fillStroke(c, PAL.metal, PAL.ink, OUT);

  // the hatch opening, warm light spilling out
  const g = c.createLinearGradient(0, 0.12, 0, 0.72);
  g.addColorStop(0, '#2a1b12');
  g.addColorStop(1, '#ffca6a');
  rr(c, 0.14, 0.14, 0.72, 0.56, 0.08);
  fillStroke(c, g, PAL.ink, OUT * 0.9);

  // rolled shutter
  rr(c, 0.12, 0.06, 0.76, 0.2, 0.07);
  fillStroke(c, PAL.metalHi, PAL.ink, OUT * 0.9);
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
  fillStroke(c, PAL.counter, PAL.ink, OUT);
}

function drawTrash(c: CanvasRenderingContext2D): void {
  rr(c, 0.08, 0.2, 0.84, 0.82, 0.16);
  c.fillStyle = PAL.shadow;
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
  fillStroke(c, g, PAL.ink, OUT);
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
  fillStroke(c, PAL.binLid, PAL.ink, OUT);
  rr(c, 0.42, 0.05, 0.16, 0.1, 0.05);
  fillStroke(c, PAL.binLid, PAL.ink, OUT * 0.9);
}

/** One station tile, drawn into the unit box. */
export function drawTile(
  c: CanvasRenderingContext2D,
  tile: Tile,
  time: number,
): void {
  switch (tile.t) {
    case 'floor':
      return;
    case 'counter':
      slab(c, PAL.counterHi, PAL.counterEdge);
      if (tile.item) drawHeldItem(c, tile.item, 0.5, 0.44, 0.28);
      return;
    case 'crate':
      drawCrate(c, tile.crate ?? 'onion');
      return;
    case 'board':
      drawBoard(c, tile);
      return;
    case 'stove':
      slab(c, PAL.metalHi, PAL.metalDark);
      if (tile.pot) drawPot(c, tile.pot, time);
      return;
    case 'plates':
      drawPlates(c);
      return;
    case 'serve':
      drawServe(c, time);
      return;
    case 'trash':
      drawTrash(c);
      return;
  }
}

/** Whole kitchen: floor, then every station. Caller sets board transform. */
export function drawKitchen(
  c: CanvasRenderingContext2D,
  snap: Snapshot,
  T: number,
  time: number,
): void {
  drawFloor(c, snap.w, snap.h, T);
  for (let y = 0; y < snap.h; y++) {
    for (let x = 0; x < snap.w; x++) {
      const tile = snap.tiles[y * snap.w + x];
      if (!tile || tile.t === 'floor') continue;
      c.save();
      c.translate(x * T, y * T);
      c.scale(T, T);
      drawTile(c, tile, time);
      c.restore();
    }
  }
}
