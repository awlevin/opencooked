// Chef blobs: round body, puffy hat, eyes that follow the facing direction,
// squash-and-stretch on dash, and whatever they are carrying held out front.

import { PLAYER_RADIUS } from '../../../shared/types';
import type { RenderPlayer } from '../state';
import { drawHeldItem } from './ingredients';
import {
  PAL,
  circle,
  ellipse,
  fillStroke,
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
    drawHeldItem(c, p.held, hx, hyy, R * 0.62);
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
  c.font = `800 ${size}px "Baloo 2", "Trebuchet MS", system-ui, sans-serif`;
  const name = p.name.length > 10 ? `${p.name.slice(0, 9)}…` : p.name;
  const w = c.measureText(name).width + size * 0.9;
  const h = size * 1.36;
  rr(c, x - w / 2, y - h / 2, w, h, h / 2);
  fillStroke(c, 'rgba(30, 17, 9, 0.86)', p.color, Math.max(2, size * 0.13));
  c.restore();
  text(c, name, x, y + size * 0.04, {
    size,
    fill: PAL.cream,
    weight: 800,
  });
}
