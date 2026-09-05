// Shared art direction: the world-independent palette, drawing primitives,
// easing helpers. Everything is drawn with paths — no images, no assets.
//
// What is NOT in here is the world's palette. Floors, counters, the backdrop
// and the HUD band come from the level's `WorldTheme` (shared/levels), which
// the renderer resolves once per frame and passes down. Keeping the two apart
// is the whole trick behind three worlds sharing one set of draw calls: a
// function that takes its colours as an argument cannot be tied to a world,
// and an onion has to be the same onion in all of them.

import { INGREDIENTS, type IngredientType } from '@/shared/catalogue';

/** Colours that belong to the food, the cookware and the chefs — never to a world. */
export const PAL = {
  ink: '#3b2314',
  inkSoft: '#6b4526',
  shadow: 'rgba(28, 16, 9, 0.42)',

  crate: '#b9793d',
  crateSlat: '#cf8f4f',
  crateDark: '#8c5628',

  board: '#d3a165',
  boardEdge: '#a3743f',

  metal: '#5b5f68',
  metalDark: '#3c4048',
  metalHi: '#8b919c',

  pot: '#4a4e57',
  potHi: '#6e737e',
  potRim: '#2f3238',

  bin: '#4f6157',
  binDark: '#374841',
  binLid: '#63796d',

  plate: '#fdfdfd',
  plateRim: '#cfd8e3',
  plateShade: '#dfe6ee',

  cream: '#fff6e3',
  butter: '#ffd23f',
  tomato: '#e8503a',
  mint: '#2ec4a0',
  green: '#3fbf6f',
  amber: '#f2a13c',
} as const;

/**
 * Body colours, straight from the catalogue: the sim owns what an ingredient
 * looks like so a new ingredient never needs a second table here.
 */
export const INGREDIENT_COLORS: Record<IngredientType, string> = Object.fromEntries(
  Object.values(INGREDIENTS).map((d) => [d.id, d.color]),
) as Record<IngredientType, string>;

/** Secondary colour (sprout, rind, grill marks) for the same ingredient. */
export const INGREDIENT_ACCENTS: Record<IngredientType, string> = Object.fromEntries(
  Object.values(INGREDIENTS).map((d) => [d.id, d.accent]),
) as Record<IngredientType, string>;

/**
 * Canvas font stack. `next/font` hashes the family name at build time, so the
 * host bootstrap injects the real name via `setFontFamily` before the first
 * frame; the literal below stays as the fallback chain.
 */
const FALLBACK_FONT =
  '"Baloo 2", "Fredoka", "Trebuchet MS", "Avenir Next Rounded", system-ui, sans-serif';

let FONT = FALLBACK_FONT;

/** Idempotent — safe under React StrictMode's double mount. */
export function setFontFamily(family: string | null): void {
  FONT = family ? `${family}, ${FALLBACK_FONT}` : FALLBACK_FONT;
}

export const font = (px: number, weight = 800): string =>
  `${weight} ${px.toFixed(1)}px ${FONT}`;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * World -> board-local pixels. Integer world coordinates are TILE CENTRES
 * (see shared/levels/parse.ts), so tile (i, j) is drawn at (i*T, j*T) while an
 * entity standing at world (i, j) is drawn half a tile further in.
 */
export const worldToPx = (v: number, T: number): number => (v + 0.5) * T;

/** Rounded-rect path (no fill/stroke). Radius is clamped to the box. */
export function rr(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const k = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  c.beginPath();
  c.moveTo(x + k, y);
  c.lineTo(x + w - k, y);
  c.quadraticCurveTo(x + w, y, x + w, y + k);
  c.lineTo(x + w, y + h - k);
  c.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  c.lineTo(x + k, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - k);
  c.lineTo(x, y + k);
  c.quadraticCurveTo(x, y, x + k, y);
  c.closePath();
}

/** Fill + chunky outline in one go. */
export function fillStroke(
  c: CanvasRenderingContext2D,
  fill: string | CanvasGradient | null,
  stroke: string | null,
  width: number,
): void {
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = width;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.stroke();
  }
}

export function circle(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.closePath();
}

export function ellipse(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
): void {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.closePath();
}

/** Centred text with an optional cartoon outline. */
export function text(
  c: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  opts: {
    size: number;
    weight?: number;
    fill?: string;
    outline?: string;
    outlineWidth?: number;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
    letterSpacing?: number;
  },
): void {
  c.save();
  c.font = font(opts.size, opts.weight ?? 800);
  c.textAlign = opts.align ?? 'center';
  c.textBaseline = opts.baseline ?? 'middle';
  if (opts.letterSpacing !== undefined) {
    // letterSpacing is Chromium-only; harmless elsewhere.
    (c as unknown as { letterSpacing: string }).letterSpacing =
      `${opts.letterSpacing}px`;
  }
  if (opts.outline) {
    c.lineWidth = opts.outlineWidth ?? opts.size * 0.22;
    c.lineJoin = 'round';
    c.strokeStyle = opts.outline;
    c.strokeText(s, x, y);
  }
  c.fillStyle = opts.fill ?? PAL.cream;
  c.fillText(s, x, y);
  c.restore();
}

/** Soft drop shadow around whatever `draw` paints. */
export function withShadow(
  c: CanvasRenderingContext2D,
  blur: number,
  dy: number,
  color: string,
  draw: () => void,
): void {
  c.save();
  c.shadowColor = color;
  c.shadowBlur = blur;
  c.shadowOffsetY = dy;
  draw();
  c.restore();
}

/**
 * Parse `#rgb`, `#rrggbb` or `rgb(r, g, b)`. Needed because `mix` returns
 * rgb() strings and callers happily mix the result again.
 */
function parseColor(s: string): [number, number, number] {
  if (s.charCodeAt(0) === 35 /* # */) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const n = parseInt(hex, 16);
      const r = (n >> 8) & 15;
      const g = (n >> 4) & 15;
      const b = n & 15;
      return [r * 17, g * 17, b * 17];
    }
    const n = parseInt(hex.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/-?\d+(\.\d+)?/g);
  if (!m || m.length < 3) return [0, 0, 0];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

/** Mix two colours. Accepts hex or the rgb() strings this function returns. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseColor(a);
  const pb = parseColor(b);
  return `rgb(${Math.round(lerp(pa[0], pb[0], t))}, ${Math.round(
    lerp(pa[1], pb[1], t),
  )}, ${Math.round(lerp(pa[2], pb[2], t))})`;
}

/** Darken a hex colour toward black. */
export function shade(hex: string, amount: number): string {
  return mix(hex, '#000000', amount);
}

/** Lighten a hex colour toward white. */
export function tint(hex: string, amount: number): string {
  return mix(hex, '#ffffff', amount);
}
