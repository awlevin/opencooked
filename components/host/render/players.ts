// Chef blobs: round body, puffy hat, eyes that follow the facing direction,
// squash-and-stretch on dash, and whatever they are carrying held out front.
//
// Also the aim: the chevron in front of a chef and the highlight on the
// station they are about to act on. Both are the same one fact drawn twice —
// `PlayerState.target`, straight from the sim — so the tile that lights up is
// always the tile the button hits.

import { PLAYER_RADIUS } from '@/shared/types';
import type { AimView, RenderPlayer } from '../state';
import { drawHeldItem } from './ingredients';
import {
  PAL,
  circle,
  ellipse,
  fillStroke,
  font,
  rr,
  shade,
  text,
  tint,
  worldToPx,
} from './theme';

/**
 * Fill a composite path with a cartoon outline: paint an inflated ink
 * silhouette first, then the real colour on top. Keeps overlapping circles
 * (hat puffs) from showing seams.
 */
function inked(
  c: CanvasRenderingContext2D,
  path: () => void,
  fill: string,
  lw: number,
): void {
  c.save();
  c.beginPath();
  path();
  c.strokeStyle = PAL.ink;
  c.lineWidth = lw * 2;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.stroke();
  c.fillStyle = PAL.ink;
  c.fill();
  c.beginPath();
  path();
  c.fillStyle = fill;
  c.fill();
  c.restore();
}

function drawChefKnife(c: CanvasRenderingContext2D, s: number): void {
  c.beginPath();
  c.moveTo(-s * 0.85, -s * 0.18);
  c.lineTo(s * 0.2, -s * 0.28);
  c.lineTo(s * 0.28, s * 0.08);
  c.lineTo(-s * 0.85, s * 0.16);
  c.closePath();
  fillStroke(c, '#e6edf5', PAL.ink, s * 0.16);
  rr(c, s * 0.26, -s * 0.18, s * 0.6, s * 0.34, s * 0.14);
  fillStroke(c, '#3f2a1c', PAL.ink, s * 0.16);
}

/**
 * The facing chevron: a small arrow on the floor just in front of the chef, in
 * their own colour. It is the cheapest possible answer to "which way am I
 * pointing?", and it brightens as the aim settles on a station, so locking on
 * is something you see rather than something you find out by pressing.
 *
 * It sits far enough out to clear the chef's own hat and whatever they are
 * carrying — otherwise it vanishes exactly when a chef turns their back on the
 * camera, which is when you most need it — and just touches the tile ahead, so
 * the arrow and the highlight it points into read as one thing.
 */
function drawChevron(
  c: CanvasRenderingContext2D,
  dx: number,
  dy: number,
  R: number,
  color: string,
  lock: number,
): void {
  const len = R * 0.6;
  const halfW = R * 0.58;
  c.save();
  c.translate(dx * R * 1.8, dy * R * 1.8);
  c.rotate(Math.atan2(dy, dx));
  c.globalAlpha = 0.5 + 0.45 * lock;
  c.beginPath();
  c.moveTo(-len * 0.55, -halfW);
  c.lineTo(len * 0.7, 0);
  c.lineTo(-len * 0.55, halfW);
  // A concave tail turns the triangle into a chevron, which reads as a
  // direction rather than as a piece of food.
  c.quadraticCurveTo(-len * 0.16, 0, -len * 0.55, -halfW);
  c.closePath();
  fillStroke(c, tint(color, 0.18), PAL.ink, R * 0.085);
  c.restore();
}

export function drawPlayer(
  c: CanvasRenderingContext2D,
  p: RenderPlayer,
  T: number,
  time: number,
): void {
  const R = PLAYER_RADIUS * T;
  const lw = R * 0.13;
  const dx = Math.cos(p.angle);
  const dy = Math.sin(p.angle);

  c.save();
  c.translate(worldToPx(p.x, T), worldToPx(p.y, T));

  // ground shadow
  ellipse(c, 0, R * 0.86, R * 0.92, R * 0.36);
  c.fillStyle = 'rgba(30, 16, 8, 0.35)';
  c.fill();

  drawChevron(c, dx, dy, R, p.color, p.aim ? p.aim.a : 0);

  // dash afterimages
  if (p.dashing) {
    for (let i = 1; i <= 3; i++) {
      c.save();
      c.globalAlpha = 0.16 * p.dashT * (1 - i / 4);
      circle(c, -dx * R * i * 0.62, -dy * R * i * 0.62, R * (1 - i * 0.12));
      c.fillStyle = p.color;
      c.fill();
      c.restore();
    }
  }

  // Held items sit in front of the chef, except when they are facing away
  // from the camera — then the body should occlude what they carry.
  // Facing away from the camera the chef would hide whatever they carry, so
  // the item swings out to their side and the body overlaps it instead.
  const facingAway = dy < -0.35;
  const drawHeld = (): void => {
    if (!p.held) return;
    const hx = facingAway ? -dy * R * 1.15 + dx * R * 0.3 : dx * R * 1.3;
    const hyy =
      (facingAway ? dx * R * 1.15 + dy * R * 0.3 : dy * R * 1.3) + R * 0.1;
    ellipse(c, hx, hyy + R * 0.5, R * 0.5, R * 0.2);
    c.fillStyle = 'rgba(30, 16, 8, 0.22)';
    c.fill();
    drawHeldItem(c, p.held, hx, hyy, R * 0.62, time);
  };
  if (facingAway) drawHeld();

  c.save();
  // squash/stretch along the dash axis
  if (p.dashing) {
    c.rotate(p.angle);
    c.scale(1 + 0.34 * p.dashT, 1 - 0.24 * p.dashT);
    c.rotate(-p.angle);
  }

  // body
  const g = c.createLinearGradient(0, -R, 0, R);
  g.addColorStop(0, tint(p.color, 0.28));
  g.addColorStop(1, shade(p.color, 0.2));
  circle(c, 0, 0, R);
  fillStroke(c, g, PAL.ink, lw * 1.5);

  // apron bib, so the blob reads as a cook
  c.save();
  circle(c, 0, 0, R - lw * 0.6);
  c.clip();
  c.beginPath();
  c.ellipse(dx * R * 0.42, dy * R * 0.42 + R * 0.28, R * 0.62, R * 0.5, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255, 252, 242, 0.34)';
  c.fill();
  c.restore();

  // eyes
  const ex = -dy;
  const ey = dx;
  for (const s of [-1, 1]) {
    const bx = dx * R * 0.3 + ex * s * R * 0.36;
    const by = dy * R * 0.3 + ey * s * R * 0.36;
    circle(c, bx, by, R * 0.24);
    fillStroke(c, '#fffdf7', PAL.ink, lw * 0.9);
    circle(c, bx + dx * R * 0.09, by + dy * R * 0.09, R * 0.11);
    c.fillStyle = PAL.ink;
    c.fill();
  }

  // chef hat
  const hy = -R * 0.92;
  inked(
    c,
    () => {
      c.moveTo(-R * 0.6, hy + R * 0.02);
      c.lineTo(R * 0.6, hy + R * 0.02);
      c.lineTo(R * 0.6, hy + R * 0.34);
      c.lineTo(-R * 0.6, hy + R * 0.34);
      c.closePath();
      for (const [cx, cy, r] of [
        [-R * 0.4, hy - R * 0.16, R * 0.36],
        [R * 0.4, hy - R * 0.16, R * 0.36],
        [0, hy - R * 0.34, R * 0.44],
      ] as const) {
        c.moveTo(cx + r, cy);
        c.arc(cx, cy, r, 0, Math.PI * 2);
      }
    },
    '#fffdf6',
    lw,
  );
  // hat band
  rr(c, -R * 0.62, hy + R * 0.04, R * 1.24, R * 0.28, R * 0.12);
  fillStroke(c, shade(p.color, 0.05), PAL.ink, lw);

  c.restore(); // squash

  if (!facingAway) drawHeld();

  // spraying: a cone of foam out of the horn, toward whatever is in front
  if (p.spraying) {
    const reach = R * 3.4;
    const spread = R * 1.05;
    c.save();
    c.beginPath();
    c.moveTo(dx * R * 1.15 + ex * R * 0.18, dy * R * 1.15 + ey * R * 0.18);
    c.lineTo(dx * reach + ex * spread, dy * reach + ey * spread);
    c.lineTo(dx * reach - ex * spread, dy * reach - ey * spread);
    c.closePath();
    c.fillStyle = 'rgba(240, 250, 255, 0.5)';
    c.fill();
    for (let i = 0; i < 8; i++) {
      const t = (time * 1.9 + i * 0.13) % 1;
      const side = i % 2 === 0 ? 1 : -1;
      const off = side * spread * t * (0.55 + (i % 3) * 0.24);
      const d = R * 1.1 + t * (reach - R * 1.1);
      c.globalAlpha = 0.95 * (1 - t * 0.55);
      circle(c, dx * d + ex * off, dy * d + ey * off, R * (0.2 + t * 0.5));
      c.fillStyle = '#f7fdff';
      c.fill();
    }
    // foam piling up where the cone lands
    for (let i = 0; i < 4; i++) {
      const t = (time * 2.6 + i * 0.25) % 1;
      const a = i * 1.7 + time * 1.3;
      c.globalAlpha = 0.75 * (1 - t);
      circle(
        c,
        dx * reach + Math.cos(a) * R * (0.5 + t * 1.1),
        dy * reach + Math.sin(a) * R * (0.5 + t * 1.1),
        R * (0.22 + t * 0.3),
      );
      c.fillStyle = '#ffffff';
      c.fill();
    }
    c.restore();
  }

  // chopping: knife jabbing at the board in front
  if (p.chopping) {
    const bob = Math.abs(Math.sin(time * 11));
    const reach = R * 2.6;
    c.save();
    c.translate(dx * reach, dy * reach - R * (0.2 + bob * 0.7));
    c.rotate(Math.atan2(dy, dx) - Math.PI / 2 - 0.5 + bob * 0.6);
    drawChefKnife(c, R * 0.9);
    c.restore();
    c.save();
    c.globalAlpha = 0.5 + bob * 0.5;
    c.strokeStyle = '#fff6d8';
    c.lineWidth = R * 0.12;
    c.lineCap = 'round';
    for (const s of [-1, 1]) {
      c.beginPath();
      c.moveTo(dx * R * 1.5 + ex * s * R * 0.6, dy * R * 1.5 + ey * s * R * 0.6);
      c.lineTo(dx * R * 1.8 + ex * s * R * 0.85, dy * R * 1.8 + ey * s * R * 0.85);
      c.stroke();
    }
    c.restore();
  }

  c.restore();
}

/**
 * Every chef's target station, in their own colour. Drawn over the kitchen and
 * under the chefs, so a highlight never covers a face.
 *
 * Two chefs may want the same counter — which happens constantly around the
 * one plate stack — so their rings nest instead of stacking, and the tile says
 * "both of you" rather than showing whichever colour was painted last.
 */
export function drawAim(
  c: CanvasRenderingContext2D,
  players: readonly RenderPlayer[],
  T: number,
  time: number,
): void {
  // At most one entry per chef, so this is a handful of slots, not a table.
  const depth = new Map<number, number>();
  for (const p of players) {
    const aim = p.aim;
    if (!aim) continue;
    const n = depth.get(aim.idx) ?? 0;
    depth.set(aim.idx, n + 1);
    drawAimTile(c, aim, T, p.color, n, time);
  }
}

function drawAimTile(
  c: CanvasRenderingContext2D,
  aim: AimView,
  T: number,
  color: string,
  depth: number,
  time: number,
): void {
  // Barely breathing: enough that the highlight reads as live from a sofa,
  // never enough to compete with a pot boiling or a tile on fire.
  const pulse = 0.9 + 0.1 * Math.sin(time * 3.4 + depth * 1.7);
  const a = aim.a * pulse;
  // The station's slab, not the whole cell: a ring around the tile grid would
  // look like a debug overlay. Each extra chef tucks one ring further in.
  const i = 0.05 + depth * 0.085;
  const x = aim.x * T + (0.02 + i) * T;
  const y = aim.y * T + (0.02 + i) * T;
  const w = (0.96 - i * 2) * T;
  const h = (0.9 - i * 2) * T;
  if (w <= 0 || h <= 0) return;

  c.save();
  c.translate(0, -T * 0.03); // sit on the counter top, not on its front face
  rr(c, x, y, w, h, T * 0.15);
  // A wash of light rather than a coat of paint, so whatever is on the counter
  // keeps its own colours.
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = a * 0.13;
  c.fillStyle = color;
  c.fill();
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = a * 0.95;
  // Barely lightened: a tinted ring goes pastel on a cream counter, and pastel
  // is the one thing that does not survive the trip across a living room. The
  // glow stays tight for the same reason — spread it and it floods the tile,
  // leaving a pale block where there should be a ring.
  c.strokeStyle = tint(color, 0.12);
  c.lineWidth = Math.max(1.5, T * 0.058);
  c.shadowColor = color;
  c.shadowBlur = T * 0.1;
  c.stroke();
  c.restore();
}

/** Name pill above the chef. Drawn unscaled so the text stays crisp. */
export function drawPlayerLabel(
  c: CanvasRenderingContext2D,
  p: RenderPlayer,
  T: number,
  u: number,
): void {
  const R = PLAYER_RADIUS * T;
  const size = Math.max(14, 26 * u);
  const x = worldToPx(p.x, T);
  const y = worldToPx(p.y, T) - R * 2.3;
  c.save();
  c.font = font(size, 800);
  const name = p.name.length > 10 ? `${p.name.slice(0, 9)}…` : p.name;
  // A chef on a direct peer connection carries a small bolt inside the pill.
  const boltW = p.local ? size * 0.72 : 0;
  const w = c.measureText(name).width + size * 0.9 + boltW;
  const h = size * 1.36;
  rr(c, x - w / 2, y - h / 2, w, h, h / 2);
  fillStroke(c, 'rgba(30, 17, 9, 0.86)', p.color, Math.max(2, size * 0.13));
  c.restore();
  text(c, name, x + boltW / 2, y + size * 0.04, {
    size,
    fill: PAL.cream,
    weight: 800,
  });
  if (p.local) drawBolt(c, x - w / 2 + size * 0.52, y, size * 0.5);
}

/**
 * The "local" mark: a lightning bolt, because that is what it means — this
 * chef's phone is talking straight to this screen. Small, mint, no words.
 */
function drawBolt(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  c.save();
  c.translate(x, y);
  c.beginPath();
  c.moveTo(s * 0.28, -s);
  c.lineTo(-s * 0.42, s * 0.14);
  c.lineTo(s * 0.02, s * 0.14);
  c.lineTo(-s * 0.26, s);
  c.lineTo(s * 0.46, -s * 0.2);
  c.lineTo(s * 0.02, -s * 0.2);
  c.closePath();
  fillStroke(c, PAL.mint, PAL.ink, Math.max(1, s * 0.24));
  c.restore();
}
