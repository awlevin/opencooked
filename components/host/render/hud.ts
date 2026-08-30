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

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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

  // --- score ---
  const sx = u * 40;
  star(c, sx + u * 22, midY - u * 4, u * 24, PAL.butter);
  text(c, 'SCORE', sx + u * 56, midY - u * 26, {
    size: u * 26,
    weight: 700,
    fill: 'rgba(255,246,227,0.72)',
    align: 'left',
    letterSpacing: u * 4,
  });
  text(c, String(snap.score), sx + u * 54, midY + u * 20, {
    size: u * 64,
    fill: PAL.cream,
    outline: PAL.ink,
    outlineWidth: u * 10,
    align: 'left',
  });

  // served / missed chips
  const chipY = hudH - u * 30;
  const chips: Array<[string, string, number]> = [
    ['✓', '#4fd18b', snap.served],
    ['✕', PAL.tomato, snap.missed],
  ];
  let cx = sx;
  for (const [glyph, col, val] of chips) {
    const label = `${glyph} ${val}`;
    c.font = font(u * 28, 800);
    const w = c.measureText(label).width + u * 26;
    rr(c, cx, chipY - u * 20, w, u * 40, u * 20);
    fillStroke(c, 'rgba(255,246,227,0.10)', 'rgba(255,246,227,0.22)', u * 2);
    text(c, label, cx + w / 2, chipY, { size: u * 28, weight: 800, fill: col });
    cx += w + u * 12;
  }

  // --- clock ---
  const low = msLeft <= 30_000;
  const pulse = low ? 0.5 + 0.5 * Math.sin(time * 7) : 0;
  const tw = u * 250;
  const th = u * 104;
  c.save();
  c.translate(W / 2, midY + u * 2);
  c.scale(1 + pulse * 0.05, 1 + pulse * 0.05);
  rr(c, -tw / 2, -th / 2, tw, th, u * 26);
  fillStroke(
    c,
    low ? `rgba(120, 22, 14, ${0.75 + pulse * 0.25})` : 'rgba(255,246,227,0.10)',
    low ? PAL.tomato : 'rgba(255,246,227,0.24)',
    u * 4,
  );
  text(c, clock(msLeft), 0, u * 4, {
    size: u * 74,
    fill: low ? '#ffdcd4' : PAL.cream,
    outline: PAL.ink,
    outlineWidth: u * 10,
  });
  c.restore();
  text(c, 'TIME', W / 2, hudH - u * 26, {
    size: u * 22,
    weight: 700,
    fill: 'rgba(255,246,227,0.6)',
    letterSpacing: u * 5,
  });

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
