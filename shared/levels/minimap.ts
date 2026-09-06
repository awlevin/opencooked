// A kitchen, drawn small: the picture the TV lobby card and the phone chooser
// both show before anyone commits to a level.
//
// DOM-free on purpose. It takes a 2D context and a box in device pixels and
// letterboxes the kitchen inside it, so an 11x7 and a 15x8 level can share one
// fixed-size preview and the layout never jumps between them. Nothing here
// reads the document, so the module is safe to import from anywhere that has a
// canvas — including a phone screen that has no renderer of its own.
//
// The picture has one job: tell you what kind of room this is. So the floor is
// the world's own floor a shade down, and every station is the colour of the
// thing it is —
// crates carry their ingredient's colour, stoves are dark iron, boards are
// wood, plates white, the pass gold. A player who has cooked one level can
// read the next one from the thumbnail.

import { DISHES, INGREDIENTS } from '../catalogue';
import type { Tile } from '../types';
import type { Level } from './parse';
import type { WorldTheme } from './types';

/** How many dishes to name before falling back to "+n more". */
const MENU_SHOWN = 3;

/** Equipment colours. Gear is gear: it does not change with the world. */
const STATION: Partial<Record<Tile['t'], string>> = {
  board: '#c8934f', // butcher block
  stove: '#3c4048', // cast iron
  plates: '#fbfbfd',
  trash: '#697a71',
  extinguisher: '#c0392b',
};

/* ------------------------------- palette -------------------------------- */

/** `#rgb` / `#rrggbb` -> [r, g, b]. Anything else comes back black. */
function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const body = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!;
  const n = Number.parseInt(body, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blend two colours. `t` is how much of `b` lands on `a`. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const at = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return `rgb(${at(ar, br)}, ${at(ag, bg)}, ${at(ab, bb)})`;
}

/** Darken a colour towards ink. Used for lids, rims and shadows. */
export function shade(hex: string, amount: number): string {
  return mixHex(hex, '#000000', amount);
}

/** What colour a station is on the minimap. */
export function stationColor(tile: Tile, theme: WorldTheme): string {
  if (tile.t === 'serve') return theme.accent;
  if (tile.t === 'crate') return tile.crate ? INGREDIENTS[tile.crate].color : theme.counterTop;
  return STATION[tile.t] ?? theme.counterTop;
}

/* -------------------------------- drawing -------------------------------- */

/**
 * How far the floor is pushed down from the world's own floor colour. A
 * thumbnail has to answer "where is the room and where are the stations" in
 * one glance, and the night bar's floor and its counters are both mid blue;
 * darkening the floor keeps every world's hue and buys the contrast back.
 */
const FLOOR_SHADE = 0.22;

/** The world's floor, in the pattern its motif lays: planks, decking, tiles. */
function floor(
  c: CanvasRenderingContext2D,
  theme: WorldTheme,
  w: number,
  h: number,
  cell: number,
): void {
  c.fillStyle = shade(theme.floorA, FLOOR_SHADE);
  c.fillRect(0, 0, w, h);
  c.fillStyle = shade(theme.floorB, FLOOR_SHADE);
  if (theme.motif === 'night') {
    // Checkerboard, like the sushi bar's tiles.
    for (let y = 0; y * cell < h; y++) {
      for (let x = 0; x * cell < w; x++) {
        if ((x + y) % 2 === 0) continue;
        c.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  } else if (theme.motif === 'seaside') {
    // Decking: boards running away from the pass.
    for (let x = 0; x * cell < w; x += 2) c.fillRect(x * cell, 0, cell, h);
  } else {
    // Planks, laid across the room.
    for (let y = 0; y * cell < h; y += 2) c.fillRect(0, y * cell, w, cell);
  }
}

/** One station: its own colour, a cartoon outline, and a mark you can name. */
function station(
  c: CanvasRenderingContext2D,
  tile: Tile,
  theme: WorldTheme,
  x: number,
  y: number,
  cell: number,
): void {
  const base = stationColor(tile, theme);
  c.fillStyle = base;
  c.fillRect(x, y, cell, cell);

  const cx = x + cell / 2;
  const cy = y + cell / 2;
  switch (tile.t) {
    case 'crate':
      // A box, not a coloured square: a dark rim and a lid, with the
      // ingredient's own colour filling it.
      c.fillStyle = shade(base, 0.5);
      c.fillRect(x, y, cell, cell);
      c.fillStyle = base;
      c.fillRect(x + cell * 0.14, y + cell * 0.14, cell * 0.72, cell * 0.72);
      c.fillStyle = shade(base, 0.28);
      c.fillRect(x + cell * 0.14, y + cell * 0.14, cell * 0.72, cell * 0.2);
      break;
    case 'stove':
      // The ring, lit.
      c.fillStyle = '#e2652b';
      c.beginPath();
      c.arc(cx, cy, cell * 0.3, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#2b2e34';
      c.beginPath();
      c.arc(cx, cy, cell * 0.13, 0, Math.PI * 2);
      c.fill();
      break;
    case 'board':
      // A pale slab with a knife line across it.
      c.fillStyle = mixHex(base, '#fff3d8', 0.55);
      c.fillRect(x + cell * 0.18, y + cell * 0.18, cell * 0.64, cell * 0.64);
      c.fillStyle = shade(base, 0.35);
      c.fillRect(x + cell * 0.24, cy - cell * 0.04, cell * 0.52, Math.max(1, cell * 0.08));
      break;
    case 'plates':
      c.strokeStyle = '#9aa6b4';
      c.lineWidth = Math.max(1, cell * 0.07);
      c.beginPath();
      c.arc(cx, cy, cell * 0.27, 0, Math.PI * 2);
      c.stroke();
      break;
    case 'serve':
      // The pass: gold, with a hatch to say food leaves through here.
      c.fillStyle = shade(base, 0.4);
      for (let i = 0; i < 3; i++) {
        c.fillRect(x + cell * (0.2 + i * 0.24), y + cell * 0.26, Math.max(1, cell * 0.1), cell * 0.48);
      }
      break;
    case 'trash':
      c.fillStyle = shade(base, 0.35);
      c.fillRect(x + cell * 0.12, y + cell * 0.2, cell * 0.76, Math.max(1, cell * 0.14));
      break;
    case 'extinguisher':
      c.fillStyle = '#ffffff';
      c.fillRect(x + cell * 0.38, y + cell * 0.22, cell * 0.24, cell * 0.56);
      break;
    default:
      // A plain counter: a lit top edge is enough to read it as a slab.
      c.fillStyle = mixHex(base, '#ffffff', 0.22);
      c.fillRect(x, y, cell, cell * 0.2);
      break;
  }

  c.strokeStyle = theme.ink;
  c.lineWidth = Math.max(1, cell * 0.09);
  c.strokeRect(x + c.lineWidth / 2, y + c.lineWidth / 2, cell - c.lineWidth, cell - c.lineWidth);
}

/**
 * Draw `level` into a `w` x `h` box, in device pixels, on its world's palette.
 *
 * The kitchen is centred and scaled to whole pixels; the bars left over are
 * filled with the world's backdrop, so a preview box of a fixed size looks
 * deliberate whatever shape the level is.
 */
export function drawMiniMap(
  c: CanvasRenderingContext2D,
  level: Level,
  theme: WorldTheme,
  w: number,
  h: number,
): void {
  if (w <= 0 || h <= 0) return;
  c.save();
  c.clearRect(0, 0, w, h);

  const backdrop = c.createLinearGradient(0, 0, 0, h);
  backdrop.addColorStop(0, theme.backdropTop);
  backdrop.addColorStop(1, theme.backdropBottom);
  c.fillStyle = backdrop;
  c.fillRect(0, 0, w, h);

  const cell = Math.max(1, Math.floor(Math.min(w / level.w, h / level.h)));
  const mapW = cell * level.w;
  const mapH = cell * level.h;
  c.translate(Math.round((w - mapW) / 2), Math.round((h - mapH) / 2));

  floor(c, theme, mapW, mapH, cell);

  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const tile = level.tiles[y * level.w + x]!;
      if (tile.t === 'floor') continue;
      station(c, tile, theme, x * cell, y * cell, cell);
    }
  }

  // Spawn dots: where the chefs will be standing.
  c.fillStyle = 'rgba(255, 255, 255, 0.62)';
  for (const s of level.spawns) {
    c.beginPath();
    c.arc((s.x + 0.5) * cell, (s.y + 0.5) * cell, cell * 0.17, 0, Math.PI * 2);
    c.fill();
  }

  // The tray's own frame, so the room ends somewhere. Lifted off the world's
  // frame colour, which on the night bar is the same near-black as its sky.
  c.strokeStyle = mixHex(theme.frame, theme.counterTop, 0.3);
  c.lineWidth = Math.max(2, cell * 0.18);
  c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, mapW - c.lineWidth, mapH - c.lineWidth);
  c.restore();
}

/** "Onion Soup · Burger · Cheeseburger +2 more" — what this level serves. */
export function menuLine(level: Level): string {
  const names = level.menu.map((id) => DISHES[id].name);
  const shown = names.slice(0, MENU_SHOWN).join(' · ');
  const rest = names.length - MENU_SHOWN;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}
