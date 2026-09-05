// A world's flourishes: the part of the look that is drawing code rather than
// a colour. Each motif owns the floor of its kitchen and nothing else — every
// stroke here lands under the stations, never across them, so a world can look
// completely different without a single station becoming harder to read.
//
// One function, switched on `theme.motif`. A new world reuses a motif until it
// earns its own; adding one is a case here plus a value in the union.

import type { WorldTheme } from '@/shared/levels';

/** Planks running left to right, staggered, with a grain line down each. */
function planks(
  c: CanvasRenderingContext2D,
  theme: WorldTheme,
  W: number,
  H: number,
  T: number,
): void {
  const plank = T * 0.62;
  const rows = Math.ceil(H / plank);
  for (let i = 0; i < rows; i++) {
    const y = i * plank;
    c.fillStyle = i % 2 === 0 ? theme.floorA : theme.floorB;
    c.fillRect(0, y, W, Math.min(plank, H - y));
    c.fillStyle = theme.floorSeam;
    c.fillRect(0, y + plank - T * 0.035, W, T * 0.035);
    // staggered butt joints
    const off = (i % 3) * T * 1.1;
    for (let x = off; x < W; x += T * 3.4) {
      c.fillRect(x, y, T * 0.035, Math.min(plank, H - y));
    }
    c.strokeStyle = theme.floorGrain;
    c.lineWidth = T * 0.018;
    c.beginPath();
    c.moveTo(0, y + plank * 0.34);
    for (let x = 0; x <= W; x += T * 0.5) {
      c.lineTo(x, y + plank * 0.34 + Math.sin((x / T + i) * 1.7) * T * 0.02);
    }
    c.stroke();
  }
}

/** Decking: the same boards, turned to run away from the pass. */
function decking(
  c: CanvasRenderingContext2D,
  theme: WorldTheme,
  W: number,
  H: number,
  T: number,
): void {
  const board = T * 0.78;
  const cols = Math.ceil(W / board);
  for (let i = 0; i < cols; i++) {
    const x = i * board;
    c.fillStyle = i % 2 === 0 ? theme.floorA : theme.floorB;
    c.fillRect(x, 0, Math.min(board, W - x), H);
    c.fillStyle = theme.floorSeam;
    c.fillRect(x + board - T * 0.045, 0, T * 0.045, H);
    // salt-worn grain, one wavering line per board
    c.strokeStyle = theme.floorGrain;
    c.lineWidth = T * 0.02;
    c.beginPath();
    c.moveTo(x + board * 0.36, 0);
    for (let y = 0; y <= H; y += T * 0.5) {
      c.lineTo(x + board * 0.36 + Math.sin((y / T + i) * 1.9) * T * 0.02, y);
    }
    c.stroke();
  }
  // Light through a striped awning, falling across the deck.
  c.save();
  c.globalCompositeOperation = 'overlay';
  const stripe = T * 1.35;
  for (let i = -Math.ceil(H / stripe); i * stripe < W; i += 2) {
    c.fillStyle = 'rgba(255, 176, 58, 0.24)';
    c.beginPath();
    c.moveTo(i * stripe, 0);
    c.lineTo(i * stripe + stripe, 0);
    c.lineTo(i * stripe + stripe + H * 0.5, H);
    c.lineTo(i * stripe + H * 0.5, H);
    c.closePath();
    c.fill();
  }
  c.restore();
}

/** Dark ceramic tiles, a neon wash at the edges, lanterns in the corners. */
function nightTiles(
  c: CanvasRenderingContext2D,
  theme: WorldTheme,
  W: number,
  H: number,
  T: number,
  time: number,
): void {
  c.fillStyle = theme.floorA;
  c.fillRect(0, 0, W, H);
  const tile = T * 0.98;
  for (let y = 0; y * tile < H; y++) {
    for (let x = 0; x * tile < W; x++) {
      if ((x + y) % 2 === 0) continue;
      c.fillStyle = theme.floorB;
      c.fillRect(x * tile, y * tile, tile, tile);
    }
  }
  c.strokeStyle = theme.floorSeam;
  c.lineWidth = Math.max(1, T * 0.03);
  c.beginPath();
  for (let x = 0; x * tile <= W; x++) {
    c.moveTo(x * tile, 0);
    c.lineTo(x * tile, H);
  }
  for (let y = 0; y * tile <= H; y++) {
    c.moveTo(0, y * tile);
    c.lineTo(W, y * tile);
  }
  c.stroke();

  // Neon over the pass, reflected in the polish of the floor.
  const glow = c.createLinearGradient(0, H, 0, H * 0.45);
  glow.addColorStop(0, theme.floorGrain);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);

  // Two paper lanterns, breathing gently out of phase.
  for (const [lx, ly, phase] of [
    [W * 0.16, H * 0.2, 0],
    [W * 0.84, H * 0.24, 2.1],
  ] as const) {
    const r = T * (1.5 + 0.06 * Math.sin(time * 1.4 + phase));
    const lamp = c.createRadialGradient(lx, ly, 0, lx, ly, r);
    lamp.addColorStop(0, 'rgba(255, 137, 122, 0.30)');
    lamp.addColorStop(0.6, 'rgba(255, 110, 140, 0.10)');
    lamp.addColorStop(1, 'rgba(255, 110, 140, 0)');
    c.fillStyle = lamp;
    c.fillRect(lx - r, ly - r, r * 2, r * 2);
  }
}

/**
 * Paint the floor of a kitchen. Called once per frame with the board's own
 * transform already applied, before any station is drawn.
 */
export function drawMotifFloor(
  c: CanvasRenderingContext2D,
  theme: WorldTheme,
  W: number,
  H: number,
  T: number,
  time: number,
): void {
  switch (theme.motif) {
    case 'seaside':
      decking(c, theme, W, H, T);
      return;
    case 'night':
      nightTiles(c, theme, W, H, T, time);
      return;
    case 'home':
      planks(c, theme, W, H, T);
      // A warm pool of light in the middle of the room.
      {
        const pool = c.createRadialGradient(W / 2, H * 0.46, 0, W / 2, H * 0.46, Math.max(W, H) * 0.5);
        pool.addColorStop(0, 'rgba(255, 226, 168, 0.16)');
        pool.addColorStop(1, 'rgba(255, 226, 168, 0)');
        c.fillStyle = pool;
        c.fillRect(0, 0, W, H);
      }
      return;
  }
}
